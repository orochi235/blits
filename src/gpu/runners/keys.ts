import { CURVE_WIDTH } from '../../easing.js';
import { cachedRunner, type Runner } from '../runner.js';
import { type ChannelCode, helpersOf, lerpWgsl } from '../wgsl/channels.js';
import { EASING_WGSL } from '../wgsl/easing.js';

/** `shift` and `locate` in `patch.ts`; `locate` gives 0 where the CPU's gives -1. */
const KEYS_WGSL = /* wgsl */ `
fn blits_keys_shift(delay: f32, phase: f32, duration: f32) -> f32 {
  if (delay == 0.0 || duration == 0.0) { return phase; }
  if (delay >= duration) { return select(0.0, 1.0, phase >= 1.0); }
  return max(0.0, (phase * duration - delay) / (duration - delay));
}

fn blits_keys_locate(s: u32, stride: u32, n: u32, p: f32) -> u32 {
  if (p <= values[s]) { return 0u; }
  if (p >= values[s + (n - 1u) * stride]) { return n; }
  var lo = 1u;
  var hi = n - 1u;
  while (lo < hi) {
    let mid = (lo + hi) >> 1u;
    if (values[s + mid * stride] >= p) { hi = mid; } else { lo = mid + 1u; }
  }
  return lo;
}
`;

/** How many numbers a voice's value for a channel of `code` takes. */
export const widthOf = (code: ChannelCode) => code.input ?? code.axes;

/** One track's WGSL: reads it at the phase into `kv`, sets `out.<name>`, and moves `t` past it. */
function track(name: string, code: ChannelCode): string {
  const w = widthOf(code);
  const stride = 1 + CURVE_WIDTH + w;
  const v = 1 + CURVE_WIDTH;
  return [
    '{',
    'let p = blits_keys_shift(values[t], phase, dur);',
    'let n = u32(values[t + 1u]);',
    'let s = t + 2u;',
    `var kv: array<f32, ${w}>;`,
    `let lo = blits_keys_locate(s, ${stride}u, n, p);`,
    'if (lo == 0u || lo >= n) {',
    `let at = s + select(n - 1u, 0u, lo == 0u) * ${stride}u + ${v}u;`,
    `for (var j = 0u; j < ${w}u; j++) { kv[j] = values[at + j]; }`,
    '} else {',
    `let a0 = s + (lo - 1u) * ${stride}u;`,
    `let b0 = s + lo * ${stride}u;`,
    'let ke = blits_ease(b0 + 1u, (p - values[a0]) / (values[b0] - values[a0]));',
    `var ka: array<f32, ${w}>;`,
    `var kb: array<f32, ${w}>;`,
    `for (var j = 0u; j < ${w}u; j++) { ka[j] = values[a0 + ${v}u + j]; kb[j] = values[b0 + ${v}u + j]; }`,
    lerpWgsl(code, w, 'kv', 'ka', 'kb', 'ke'),
    '}',
    `out.${name} = ${w === 1 ? 'kv[0]' : 'kv'};`,
    `t = s + n * ${stride}u;`,
    '}',
  ].join(' ');
}

/** Each distinct channel WGSL a track can take, by a short id for the runner key. */
const kinds = new Map<string, number>();

function kindOf(code: ChannelCode): number {
  const sig = `${widthOf(code)}|${code.lerp}|${code.lerpAll}|${helpersOf(code.helpers).join('\n')}`;
  let id = kinds.get(sig);
  if (id === undefined) {
    id = kinds.size;
    kinds.set(sig, id);
  }
  return id;
}

/** The runner for keys writing `writes`, their channels' WGSL `codes`: one per set of tracks. */
export function keysRunner(writes: readonly string[], codes: readonly ChannelCode[]): Runner {
  const key = `keys:${writes.map((n, k) => `${n}=${kindOf(codes[k] as ChannelCode)}`).join(',')}`;
  return cachedRunner(key, () => ({
    helpers: [EASING_WGSL, KEYS_WGSL, ...codes.flatMap((c) => helpersOf(c.helpers))],
    wgsl: [
      'let dur = values[base];',
      'var t = base + 1u;',
      ...writes.map((n, k) => track(n, codes[k] as ChannelCode)),
    ].join(' '),
    writes,
    fields: [],
  }));
}
