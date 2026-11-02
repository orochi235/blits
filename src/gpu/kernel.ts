import type { Shader } from './shader-patch.js';
import type { ChannelCode } from './wgsl/channels.js';

/** The most roles one frame's GPU voices may play; a frame with more keeps its channels on the CPU. */
export const MAX_ROLES = 8;
/** Invocations per workgroup. */
export const GROUP = 64;

/** A channel the kernel folds, and where its values land in the output buffer. */
export interface Output {
  readonly name: string;
  readonly axes: number;
  /** Where the channel's values start, in f32s; each subject's take `axes` from there. */
  readonly offset: number;
}

export interface Kernel {
  readonly code: string;
  readonly outputs: readonly Output[];
  /** f32s the output buffer holds. */
  readonly size: number;
  /** The subject fields, in the order each subject's take them in the subjects buffer. */
  readonly fields: readonly string[];
}

/** A number as a WGSL f32 literal. */
const lit = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * A shader body with the names its author wrote made safe: \`out.cast\` becomes \`out.o_cast\`, and
 * \`subject.\` and \`params.\` fields likewise, since WGSL reserves many plain words.
 */
export function prefixed(wgsl: string): string {
  return wgsl
    .replace(/\bout\.([A-Za-z_][A-Za-z0-9_]*)/g, 'out.o_$1')
    .replace(/\bsubject\.([A-Za-z_][A-Za-z0-9_]*)/g, 'subject.s_$1')
    .replace(/\bparams\.([A-Za-z_][A-Za-z0-9_]*)/g, 'params.p_$1');
}

const ty = (axes: number) => (axes === 1 ? 'f32' : `array<f32, ${axes}>`);
/** How many numbers a voice's value for a channel takes. */
const inputOf = (c: ChannelCode | undefined) => c?.input ?? c?.axes ?? 1;
const arr = (axes: number, e: string) => (axes === 1 ? `array<f32, 1>(${e})` : e);

/**
 * The compute shader folding `channels` from `shaders` for `subjects` subjects: one invocation per
 * subject, reading the voice table, gathering roles in a first pass over it and folding every voice
 * in voice order in a second, a role at its first member's place.
 */
export function kernel(
  shaders: readonly Shader[],
  channels: ReadonlyMap<string, ChannelCode>,
  subjects: number,
): Kernel {
  const fields = [...new Set(shaders.flatMap((s) => s.fields))].sort();
  const outputs: Output[] = [];
  let size = 0;
  for (const [name, c] of channels) {
    outputs.push({ name, axes: c.axes, offset: size });
    size += c.axes * subjects;
  }
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);
  add(
    `struct Subject { ${fields.length === 0 ? 'pad_: f32,' : fields.map((f) => `s_${f}: f32,`).join(' ')} }`,
  );
  add('@group(0) @binding(0) var<storage, read> subjects: array<Subject>;');
  add('@group(0) @binding(1) var<storage, read> table: array<f32>;');
  add('@group(0) @binding(2) var<storage, read> values: array<f32>;');
  add('@group(0) @binding(3) var<uniform> frame: vec4u;');
  add('@group(0) @binding(4) var<storage, read_write> outv: array<f32>;');
  const codes = [...channels.values()];
  const helpers = [...codes.map((c) => c.helpers ?? ''), ...shaders.map((s) => s.helpers)];
  for (const h of new Set(helpers.filter((h) => h !== ''))) add(h);
  outputs.forEach((o, c) => {
    const code = channels.get(o.name) as ChannelCode;
    add(
      `fn fold_${c}(into: array<f32, ${o.axes}>, v: array<f32, ${inputOf(code)}>, w: f32) -> array<f32, ${o.axes}> {`,
      '  var acc = into;',
      `  ${code.fold}`,
      '  return acc;',
      '}',
    );
  });
  shaders.forEach((s, i) => {
    const writes = s.writes.map((n) => ({ n, axes: inputOf(channels.get(n)) }));
    add(`struct Out_${i} { ${writes.map((w) => `o_${w.n}: ${ty(w.axes)},`).join(' ')} }`);
    if (s.params.length > 0)
      add(`struct Params_${i} { ${s.params.map((p) => `p_${p}: f32,`).join(' ')} }`);
    add(`fn patch_${i}(phase: f32, pass_index: f32, subject: Subject, base: u32) -> Out_${i} {`);
    if (s.params.length > 0)
      add(
        `  let params = Params_${i}(${s.params.map((_, k) => `values[base + ${k}u]`).join(', ')});`,
      );
    add(`  var out: Out_${i};`, `  ${prefixed(s.wgsl)}`, '  return out;', '}');
  });
  const index = new Map(outputs.map((o, c) => [o.name, c]));
  const arms = (body: (name: string, c: number, axes: number) => string) =>
    shaders
      .map((s, i) => {
        const inner = s.writes
          .filter((n) => index.has(n))
          .map((n) => body(n, index.get(n) as number, inputOf(channels.get(n))))
          .join(' ');
        return `      case ${i}u: { let d = patch_${i}(phase, pass_index, subject, base); ${inner} }`;
      })
      .join('\n');
  add(`@compute @workgroup_size(${GROUP})`, 'fn main(@builtin(global_invocation_id) id: vec3u) {');
  add('  let i = id.x;', '  if (i >= frame.y) { return; }', '  let subject = subjects[i];');
  outputs.forEach((o, c) => {
    const rest = (channels.get(o.name) as ChannelCode).rest.map(lit);
    add(`  var acc_${c} = array<f32, ${o.axes}>(${rest.join(', ')});`);
    add(
      `  var rv_${c}: array<array<f32, ${inputOf(channels.get(o.name))}>, ${MAX_ROLES}>;`,
      `  var rt_${c}: array<f32, ${MAX_ROLES}>;`,
    );
  });
  const read = [
    '    let o = k * 8u;',
    '    let w = table[o + 4u];',
    '    let role = u32(table[o + 5u]);',
    '    let phase = table[o + 2u];',
    '    let pass_index = table[o + 3u];',
    '    let base = u32(table[o + 1u]);',
  ];
  add('  for (var k = 0u; k < frame.x; k++) {', ...read);
  add(
    '    if (role == 0u || !(w > 0.0)) { continue; }',
    '    let r = role - 1u;',
    '    switch u32(table[o]) {',
  );
  add(
    arms(
      (n, c, axes) =>
        `{ let v = ${arr(axes, `d.o_${n}`)}; let t = rt_${c}[r]; let total = t + w; if (t == 0.0) { rv_${c}[r] = v; } else { for (var a = 0u; a < ${axes}u; a++) { rv_${c}[r][a] = mix(rv_${c}[r][a], v[a], w / total); } } rt_${c}[r] = total; }`,
    ),
  );
  add('      default: {}', '    }', '  }');
  add('  for (var k = 0u; k < frame.x; k++) {', ...read);
  add('    if (role != 0u) {', '      if (table[o + 6u] == 1.0) {', '        let r = role - 1u;');
  outputs.forEach((_, c) => {
    add(
      `        if (rt_${c}[r] > 0.0) { acc_${c} = fold_${c}(acc_${c}, rv_${c}[r], min(rt_${c}[r], 1.0)); }`,
    );
  });
  add(
    '      }',
    '      continue;',
    '    }',
    '    if (!(w > 0.0)) { continue; }',
    '    switch u32(table[o]) {',
  );
  add(arms((n, c, axes) => `acc_${c} = fold_${c}(acc_${c}, ${arr(axes, `d.o_${n}`)}, w);`));
  add('      default: {}', '    }', '  }');
  outputs.forEach((o, c) => {
    const b = (channels.get(o.name) as ChannelCode).bounds;
    const v = b === undefined ? `acc_${c}[a]` : `clamp(acc_${c}[a], ${lit(b[0])}, ${lit(b[1])})`;
    add(
      `  for (var a = 0u; a < ${o.axes}u; a++) { outv[${o.offset}u + i * ${o.axes}u + a] = ${v}; }`,
    );
  });
  add('}');
  return { code: lines.join('\n'), outputs, size, fields };
}
