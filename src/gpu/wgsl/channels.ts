import { blendRuleOf } from '../../blend-modes.js';
import { numericOf } from '../../channels.js';
import { extremeOf } from '../../extremes.js';
import type { Channel } from '../../types.js';

/**
 * A channel's WGSL: how many numbers a subject's value takes, its rest, and how a voice's value
 * `v` at weight `w` folds into `acc`. Each snippet works on `array<f32, N>` values named `acc`
 * and `v`, and `fold` assigns `acc`.
 */
export interface ChannelCode {
  readonly axes: number;
  readonly rest: readonly number[];
  readonly fold: string;
  /** How many numbers a voice's value takes, where that differs from the folded value's `axes`. */
  readonly input?: number;
  /** WGSL declarations `fold` and `lerp` use, each included once in a kernel. */
  readonly helpers?: string | readonly string[];
  /** The channel's bounds, which its folded value is clamped to, as the CPU's `clamp` does. */
  readonly bounds?: readonly [number, number];
  /**
   * The channel's `lerp` on one axis, as a WGSL expression of `x`, `y` and `u`: how a role's members
   * blend, and how keyframes interpolate. Undefined where the GPU has none yet; a role then mixes
   * straight.
   */
  readonly lerp?: string;
  /** The CPU `lerp` that `lerp` ports: a keys track interpolating by any other stays on the CPU. */
  readonly source?: Channel<unknown>['lerp'];
}

/**
 * WGSL setting `out`, an `array<f32, n>`, to arrays `x` and `y` interpolated by `u` as `code`'s
 * `lerp` does, or straight where it has none.
 */
export function lerpWgsl(
  code: ChannelCode | undefined,
  n: number,
  out: string,
  x: string,
  y: string,
  u: string,
): string {
  return `for (var a = 0u; a < ${n}u; a++) { let x = ${x}[a]; let y = ${y}[a]; let u = ${u}; ${out}[a] = ${code?.lerp ?? STRAIGHT}; }`;
}

/** A runner's or channel's `helpers`, as a list. */
export const helpersOf = (h: string | readonly string[] | undefined): readonly string[] =>
  h === undefined ? [] : typeof h === 'string' ? [h] : h;

/** The `lerp` of every rule whose values interpolate as plain numbers. */
const STRAIGHT = 'mix(x, y, u)';

/** A number as a WGSL f32 literal. */
const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/** Each stock op's fold of one axis `a`, its rest, for a channel of numbers or a `vec` of them. */
const OPS: Record<string, { rest: number; fold: string }> = {
  sum: { rest: 0, fold: 'acc[a] = acc[a] + v[a] * w;' },
  mul: { rest: 1, fold: 'acc[a] = acc[a] * (1.0 + (v[a] - 1.0) * w);' },
  max: { rest: 0, fold: 'acc[a] = max(acc[a], v[a] * w);' },
};

function stock(op: string, axes: number): ChannelCode {
  const o = OPS[op] as { rest: number; fold: string };
  return {
    axes,
    rest: Array.from({ length: axes }, () => o.rest),
    fold: `for (var a = 0u; a < ${axes}u; a++) { ${o.fold} }`,
    lerp: STRAIGHT,
  };
}

/** The WGSL for a channel's rule, or undefined where the GPU has none and it stays on the CPU. */
export function codeFor(channel: Channel<unknown>): ChannelCode | undefined {
  const code = ruleOf(channel);
  if (code === undefined) return undefined;
  return {
    ...code,
    ...(channel.bounds === undefined ? {} : { bounds: channel.bounds }),
    ...(code.lerp === undefined ? {} : { source: channel.lerp }),
  };
}

/**
 * `shortWay` in `turns.ts`, into [-turn/2, turn/2) as `Math.round` taking halves up leaves it. The
 * last two lines are not redundant: a compiler may divide by `turn` as a multiply by its f32
 * reciprocal, which puts -180 / 360 a hair below -0.5.
 */
const SHORT_WAY = `fn blits_short_way(d: f32, turn: f32) -> f32 {
  var s = d - turn * floor(d / turn + 0.5);
  if (s >= turn * 0.5) { s = s - turn; }
  if (s < -turn * 0.5) { s = s + turn; }
  return s;
}`;

function ruleOf(channel: Channel<unknown>): ChannelCode | undefined {
  const n = numericOf(channel);
  const plain = typeof channel.rest === 'number';
  if (n !== undefined && n.turn !== undefined && n.op === 'sum' && n.axes === 1 && plain) {
    const t = f(n.turn);
    return {
      axes: 1,
      rest: [0],
      helpers: SHORT_WAY,
      fold: `acc[0] = acc[0] + blits_short_way(v[0], ${t}) * w;`,
      lerp: `x + blits_short_way(y - x, ${t}) * u`,
    };
  }
  if (n !== undefined && n.turn === undefined && n.op in OPS) {
    // A vec of numbers holds an array, color() among them; one axis of it is a number.
    if (n.axes === 1 ? plain : Array.isArray(channel.rest)) return stock(n.op, n.axes);
  }
  const blend = blendRuleOf(channel);
  if (blend !== undefined) return blended(blend);
  const x = plain ? extremeOf(channel) : undefined;
  if (x?.op === 'min')
    return {
      axes: 1,
      rest: [x.top],
      fold: `acc[0] = min(acc[0], ${f(x.top)} + (v[0] - ${f(x.top)}) * w);`,
      lerp: STRAIGHT,
    };
  if (x?.op === 'screen')
    return {
      axes: 1,
      rest: [0],
      fold: 'let s = v[0] * w; acc[0] = acc[0] + s - acc[0] * s;',
      lerp: STRAIGHT,
    };
  if (x?.op === 'norm') {
    const p = f(x.power);
    const q = f(1 / x.power);
    return {
      axes: 1,
      rest: [0],
      fold: `let s = v[0] * w; if (acc[0] == 0.0) { acc[0] = s; } else if (s != 0.0) { let u = sign(acc[0]) * pow(abs(acc[0]), ${p}) + sign(s) * pow(abs(s), ${p}); acc[0] = sign(u) * pow(abs(u), ${q}); }`,
      lerp: STRAIGHT,
    };
  }
  return undefined;
}

/** OKLab to linear sRGB, unclipped: `linearOf` in `oklab.ts`. */
export const LINEAR_WGSL = `fn blits_linear(L: f32, A: f32, B: f32) -> vec3f {
  let l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  let m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  let s_ = L - 0.0894841775 * A - 1.291485548 * B;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
}`;

/** A voice's OKLab contribution `v` as the clipped linear sRGB its layer shows. */
const LAYER =
  'let c = clamp(blits_linear(v[0] / cov, v[1] / cov, v[2] / cov), vec3f(0.0), vec3f(1.0));';

/**
 * A blend mode's fold, as `foldInto` in `blend-modes.ts` (the pose one layer, `[x, y, z, tag]`)
 * or `layOn` in `stacked-modes.ts` (the pose `[tag, n, r, g, b, α, …]`).
 */
function blended(rule: NonNullable<ReturnType<typeof blendRuleOf>>): ChannelCode {
  if (rule.kind === 'free') {
    const x = rule.invert ? 'vec3f(1.0) - c' : 'c';
    const op =
      rule.op === 'screen'
        ? 'acc[a] = acc[a] + x[a] - acc[a] * x[a];'
        : rule.op === 'sum'
          ? 'acc[a] = acc[a] + x[a];'
          : 'acc[a] = max(acc[a], x[a]);';
    return {
      axes: 4,
      rest: [0, 0, 0, 0],
      helpers: LINEAR_WGSL,
      fold: `let cov = v[3]; if (cov > 0.0 && w > 0.0) { ${LAYER} let x = w * min(cov, 1.0) * (${x}); for (var a = 0u; a < 3u; a++) { ${op} } } acc[3] = ${f(rule.tag)};`,
    };
  }
  const axes = 2 + 4 * rule.layers;
  return {
    axes,
    input: 4,
    rest: [rule.tag, 0, ...Array.from({ length: 4 * rule.layers }, () => 0)],
    helpers: LINEAR_WGSL,
    fold: `let cov = v[3]; let n = u32(acc[1]); if (w > 0.0 && cov > 0.0 && n < ${rule.layers}u) { ${LAYER} let at = 2u + 4u * n; acc[1] = f32(n + 1u); acc[at] = c.x; acc[at + 1u] = c.y; acc[at + 2u] = c.z; acc[at + 3u] = w * min(cov, 1.0); }`,
  };
}
