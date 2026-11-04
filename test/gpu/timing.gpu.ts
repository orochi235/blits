import { fadeInAt, passAt, phaseAt, phaseBefore } from '../../src/clock.js';
import { CURVE_WIDTH, type Curve, curve, curveData } from '../../src/easing.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import { EASING_WGSL } from '../../src/gpu/wgsl/easing.js';
import { CLOCK_WGSL, FADE_WGSL, Flag, NONE } from '../../src/gpu/wgsl/timing.js';
import type { Easing } from '../../src/index.js';
import { Voice } from '../../src/voice.js';
import { close, closeNear, readBack, test } from './harness.js';

/** Runs `call` (a WGSL expression of `ins[IN * i ..]`, giving `OUT` f32s) once per input row. */
async function run(
  device: GpuDevice,
  ins: ArrayBuffer,
  IN: number,
  OUT: number,
  call: string,
  values: Float32Array,
  lib: string,
): Promise<Float32Array> {
  const total = ins.byteLength / 4 / IN;
  const code = `${
    /* wgsl */ `
@group(0) @binding(0) var<storage, read> values: array<f32>;
@group(0) @binding(1) var<storage, read> ins: array<f32>;
@group(0) @binding(2) var<storage, read_write> outs: array<f32>;
`
  }${lib}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= ${total}u) { return; }
  let b = i * ${IN}u;
  let o = i * ${OUT}u;
  _ = values[0];
  ${call}
}`;
  const mk = (bytes: number, usage: number) => device.createBuffer({ size: bytes, usage });
  const a = mk(Math.max(values.byteLength, 16), 0x80 | 0x08);
  const b = mk(ins.byteLength, 0x80 | 0x08);
  const c = mk(total * OUT * 4, 0x80 | 0x04);
  device.queue.writeBuffer(a, 0, values);
  device.queue.writeBuffer(b, 0, new Uint8Array(ins));
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [a, b, c].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(total / 64));
  pass.end();
  device.queue.submit([enc.finish()]);
  return readBack(device, c, 0, total * OUT * 4);
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/**
 * The f32 one step from `t` toward `dir`'s sign, as WGSL sees it: it may flush subnormals, so the
 * steps either side of 0 are the least normals.
 */
function step(t: number, dir: number): number {
  f32[0] = t;
  if (f32[0] === 0) return dir * 2 ** -126;
  u32[0] = (u32[0] as number) + ((f32[0] as number) > 0 === dir > 0 ? 1 : -1);
  return Math.abs(f32[0] as number) < 2 ** -126 ? 0 : (f32[0] as number);
}
const around = (t: number) => [step(t, -1), Math.fround(t), step(t, 1)];

interface Case {
  duration: number;
  passes: number;
  B: number;
  flags: number;
}

/** What `contribution` reads for a subject at voice time `raw`, through `Voice`'s own methods. */
function reference(c: Case, raw: number) {
  const span =
    c.duration > 0 && Number.isFinite(c.passes) ? c.duration * c.passes : Number.POSITIVE_INFINITY;
  const has = (f: Flag) => (c.flags & f) !== 0;
  const v = Object.create(Voice.prototype, {
    beginless: { value: has(Flag.BEGINLESS) },
    span: { value: span },
    freezesAfter: { value: has(Flag.FREEZES_AFTER) },
    holdsFirst: { value: has(Flag.HOLDS_FIRST) },
    hidesPast: { value: has(Flag.HIDES_PAST) },
    unstarted: { value: () => has(Flag.UNSTARTED) },
  }) as Voice<unknown, unknown>;
  const hidden = { shows: false, elapsed: Number.NaN, phase: Number.NaN, pass: Number.NaN };
  if (v.before(raw, 0) && !v.holdsFirst) return hidden;
  const e = v.shownAt(raw);
  if (Number.isNaN(e)) return hidden;
  return {
    shows: true,
    elapsed: e - c.B,
    phase: e < 0 ? phaseBefore(e, c.duration) : phaseAt(e, c.duration, c.passes),
    pass: passAt(e, c.duration, c.passes),
  };
}

test('blits_clock matches before, shownAt, phaseAt, passAt and phaseBefore', async (device) => {
  const cases: Case[] = [];
  for (const duration of [0, 1, 1000])
    for (const passes of [1, 3, Number.POSITIVE_INFINITY]) {
      const finite = duration > 0 && Number.isFinite(passes);
      // B is the start of a pass the voice can be in: never past its last.
      const Bs = [0, 2 * duration, 1e6 * duration].filter(
        (B, k, all) => all.indexOf(B) === k && (!finite || B <= (passes - 1) * duration),
      );
      for (const B of Bs)
        for (let bits = 0; bits < 32; bits++) {
          const beginless = (bits & 1) !== 0;
          const freezes = (bits & 2) !== 0;
          const hides = (bits & 4) !== 0;
          if (beginless && finite) continue;
          if (freezes && hides) continue;
          const flags =
            (beginless ? Flag.BEGINLESS : 0) |
            (freezes ? Flag.FREEZES_AFTER : 0) |
            (hides ? Flag.HIDES_PAST : 0) |
            (bits & 8 ? Flag.HOLDS_FIRST : 0) |
            (bits & 16 ? Flag.UNSTARTED : 0) |
            (finite ? Flag.FINITE : 0);
          cases.push({ duration, passes, B, flags });
        }
    }

  type Sample = { c: Case; raw: number; near: boolean; noClock: boolean };
  const samples: Sample[] = [];
  for (const c of cases) {
    const finite = (c.flags & Flag.FINITE) !== 0;
    const span = c.duration * c.passes - c.B;
    const L = finite ? c.duration * c.passes : c.duration > 0 ? 3 * c.duration : 1000;
    for (let k = 0; k <= 40; k++)
      samples.push({ c, raw: Math.fround(-2 * L + (k * L) / 10), near: false, noClock: false });
    const edges = [-c.B, ...(finite ? [span] : [])];
    if (c.duration > 0) for (let k = -2; k <= 3; k++) edges.push(k * c.duration);
    for (const e of edges)
      for (const raw of around(e)) samples.push({ c, raw, near: true, noClock: false });
    samples.push({ c, raw: 0, near: false, noClock: true });
  }

  const IN = 8;
  const buf = new ArrayBuffer(samples.length * IN * 4);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  samples.forEach((s, i) => {
    const { duration, passes, B, flags } = s.c;
    const finite = (flags & Flag.FINITE) !== 0;
    f[i * IN] = s.raw;
    u[i * IN + 1] = flags | (s.noClock ? Flag.NO_CLOCK : 0);
    f[i * IN + 2] = -B;
    f[i * IN + 3] = finite ? duration * passes - B : 0;
    f[i * IN + 4] = duration;
    f[i * IN + 5] = duration > 0 ? B / duration : 0;
    f[i * IN + 6] = finite ? passes - 1 : 0;
  });
  const got = await run(
    device,
    buf,
    IN,
    4,
    `let c = blits_clock(ins[b], bitcast<u32>(ins[b + 1u]), ins[b + 2u], ins[b + 3u], ins[b + 4u], ins[b + 5u], ins[b + 6u]);
  outs[o] = select(0.0, 1.0, c.shows);
  outs[o + 1u] = c.elapsed;
  outs[o + 2u] = c.phase;
  outs[o + 3u] = c.pass_index;`,
    new Float32Array(4),
    CLOCK_WGSL,
  );

  let failures = 0;
  const errors: string[] = [];
  samples.forEach((s, i) => {
    const { c } = s;
    const at = (raw: number) => reference(c, s.noClock ? Number.NaN : raw + c.B);
    const want = at(s.raw);
    const what = `d=${c.duration} passes=${c.passes} B=${c.B} flags=${c.flags}${s.noClock ? ' NO_CLOCK' : ''} raw=${s.raw}`;
    try {
      const shows = got[i * 4] === 1;
      if (shows !== want.shows) throw new Error(`${what}: GPU shows ${shows}, CPU ${want.shows}`);
      if (!shows) return;
      const fields = ['elapsed', 'phase', 'pass'] as const;
      const matches = (w: ReturnType<typeof at>) => {
        for (const [k, name] of fields.entries())
          close(got[i * 4 + 1 + k] as number, w[name], `${what} ${name}`);
      };
      // Near a branch, one reading one f32 step either way may explain all three instead.
      for (const t of s.near ? [step(s.raw, -1), step(s.raw, 1)] : [])
        try {
          matches(at(t));
          return;
        } catch {}
      matches(want);
    } catch (e) {
      failures++;
      if (errors.length < 20) errors.push((e as Error).message);
    }
  });
  if (failures > 0) throw new Error(`${failures}/${samples.length} wrong:\n${errors.join('\n')}`);
});

test('blits_fade_in matches fadeInAt', async (device) => {
  const eases: { name: string; curve: Curve | undefined; branchy: boolean }[] = [
    { name: 'linear', curve: undefined, branchy: false },
    { name: 'ease-in-out', curve: curve('ease-in-out'), branchy: false },
    { name: 'steps(4)', curve: curve({ steps: 4 } as Easing), branchy: true },
  ];
  const values = new Float32Array(eases.length * CURVE_WIDTH);
  eases.forEach((e, k) => {
    values.set(curveData(e.curve) as readonly number[], k * CURVE_WIDTH);
  });

  type Sample = { ease: number; fadeIn: number; end: number; shown: number };
  const samples: Sample[] = [];
  for (let ease = 0; ease < eases.length; ease++)
    for (const fadeIn of [1, 400])
      for (const shown of [0, 250]) {
        const ds = [0, fadeIn, ...around(fadeIn)];
        for (let d = -500; d <= 900; d += 5) ds.push(d);
        for (let d = -2; d <= 2; d += 0.125) ds.push(d);
        for (const d of ds) samples.push({ ease, fadeIn, shown, end: Math.fround(shown + d) });
      }

  const IN = 4;
  const buf = new ArrayBuffer(samples.length * IN * 4);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  samples.forEach((s, i) => {
    f[i * IN] = s.end;
    f[i * IN + 1] = s.shown;
    f[i * IN + 2] = s.fadeIn;
    u[i * IN + 3] = (eases[s.ease] as (typeof eases)[number]).curve ? s.ease * CURVE_WIDTH : NONE;
  });
  const got = await run(
    device,
    buf,
    IN,
    1,
    'outs[o] = blits_fade_in(ins[b], ins[b + 1u], ins[b + 2u], bitcast<u32>(ins[b + 3u]));',
    values,
    EASING_WGSL + FADE_WGSL,
  );

  samples.forEach((s, i) => {
    const e = eases[s.ease] as (typeof eases)[number];
    const at = (end: number) => fadeInAt(s.fadeIn, null, e.curve, end, s.shown, null);
    const what = `${e.name} fade ${s.fadeIn} end-shown=${s.end - s.shown}`;
    const g = got[i] as number;
    const q = ((s.end - s.shown) / s.fadeIn) * 4;
    if (e.branchy && Math.abs(q - Math.round(q)) < 1e-6) closeNear(g, at, s.end, what);
    else close(g, at(s.end), what);
  });
});
