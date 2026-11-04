import { BOUND, COAST, CRITICAL, EASED, OVER, UNDER } from '../../closed.js';
import { EASING_WGSL } from './easing.js';

/**
 * Each law of `closed()` in `src/closed.ts` on one axis, as a WGSL function of `t` seconds since
 * release giving `vec2f(y, dy)`: the distance still to go and its rate. Each reads the law's
 * constants at `values[k + 2u .. k + 4u]`, as `k1, k2, k3` sit in `[form, settle, k1, k2, k3]`.
 */
const UNDER_WGSL = /* wgsl */ `
fn blits_closed_under(k: u32, y0: f32, v0: f32, t: f32) -> vec2f {
  let zeta = values[k + 2u];
  let w0 = values[k + 3u];
  let wd = values[k + 4u];
  let e = exp(-zeta * w0 * t);
  let c = cos(wd * t);
  let s = sin(wd * t);
  let b = (v0 + zeta * w0 * y0) / wd;
  let y = e * (y0 * c + b * s);
  return vec2f(y, -zeta * w0 * y + e * wd * (b * c - y0 * s));
}`;

const CRITICAL_WGSL = /* wgsl */ `
fn blits_closed_critical(k: u32, y0: f32, v0: f32, t: f32) -> vec2f {
  let w0 = values[k + 3u];
  let e = exp(-w0 * t);
  let b = v0 + w0 * y0;
  let y = e * (y0 + b * t);
  return vec2f(y, e * b - w0 * y);
}`;

const OVER_WGSL = /* wgsl */ `
fn blits_closed_over(k: u32, y0: f32, v0: f32, t: f32) -> vec2f {
  let r1 = values[k + 2u];
  let r2 = values[k + 3u];
  let a = (v0 - r2 * y0) / (r1 - r2);
  let b = y0 - a;
  let e1 = exp(r1 * t);
  let e2 = exp(r2 * t);
  return vec2f(a * e1 + b * e2, a * r1 * e1 + b * r2 * e2);
}`;

const COAST_WGSL = /* wgsl */ `
fn blits_closed_coast(k: u32, y0: f32, v0: f32, t: f32) -> vec2f {
  let tau = values[k + 2u];
  let e = exp(-t / tau);
  return vec2f(y0 * e, (-y0 / tau) * e);
}`;

/** Where a row's flags word carries each axis's `Branch`, two bits an axis from this bit. */
export const BRANCH_SHIFT = 4;

/** Which way `solveBound` goes on an axis, decided on the CPU in f64 as `solveBound` decides it. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum Branch {
  /** The coast stops inside the bounds. */
  COAST = 0,
  /** Let go past an edge, it springs back at once. */
  BACK = 1,
  /** It coasts until it crosses an edge and springs back from there. */
  CROSS = 2,
}

/** `solveBound`, from `x0` toward `goal`, on the branch the row's flags give. */
const BOUND_WGSL = /* wgsl */ `
fn blits_closed_bound(k: u32, branch: u32, x0: f32, goal: f32, v0: f32, t: f32) -> vec2f {
  let tau = values[k + 2u];
  let y0 = x0 - goal;
  if (branch == ${Branch.COAST}u) {
    let e = exp(-t / tau);
    return vec2f(y0 * e, (-y0 / tau) * e);
  }
  let w0 = values[k + 3u];
  if (branch == ${Branch.BACK}u) {
    let e = exp(-w0 * t);
    let b = v0 + w0 * y0;
    let y = e * (y0 + b * t);
    return vec2f(y, e * b - w0 * y);
  }
  let left = 1.0 + y0 / (v0 * tau);
  if (!(left > 0.0) || t < -tau * log(left)) {
    let e = exp(-t / tau);
    return vec2f(y0 + v0 * tau * (1.0 - e), v0 * e);
  }
  let s = t + tau * log(left);
  let vc = v0 * left;
  let e = exp(-w0 * s);
  return vec2f(e * vc * s, e * vc * (1.0 - w0 * s));
}`;

const SPRUNG: Readonly<Record<number, { name: string; wgsl: string }>> = {
  [UNDER]: { name: 'under', wgsl: UNDER_WGSL },
  [CRITICAL]: { name: 'critical', wgsl: CRITICAL_WGSL },
  [OVER]: { name: 'over', wgsl: OVER_WGSL },
  [COAST]: { name: 'coast', wgsl: COAST_WGSL },
};

/** The forms the GPU runs. */
export const FORMS: ReadonlySet<number> = new Set([UNDER, CRITICAL, OVER, COAST, EASED, BOUND]);

/**
 * WGSL setting `x`, an `array<f32, n>`, to a stretch of law `form` at voice time `t`, as `closed()`
 * does: the stretch is `persub[r ..]` (release time, flags, ms, then `x0`, `v0` and `to` per axis),
 * the law's numbers sit from `values[k]`, a tween's curve at `values[k + 5u]`.
 */
export function closedWgsl(form: number, n: number): { helpers: string[]; body: string } {
  const x0 = (a: string) => `persub[r + 3u + ${a}]`;
  const v0 = (a: string) => `persub[r + ${3 + n}u + ${a}]`;
  const to = (a: string) => `persub[r + ${3 + 2 * n}u + ${a}]`;
  if (form === EASED)
    return {
      helpers: [EASING_WGSL],
      body: [
        'let u = max(0.0, t - persub[r]) / persub[r + 2u];',
        'var share = 0.0;',
        'if (u < 1.0) { share = 1.0 - blits_ease(k + 5u, u); }',
        `for (var a = 0u; a < ${n}u; a++) { let goal = ${to('a')}; x[a] = goal + (${x0('a')} - goal) * share; }`,
      ].join(' '),
    };
  const solve =
    form === BOUND
      ? {
          helpers: [BOUND_WGSL],
          call: `blits_closed_bound(k, (u32(persub[r + 1u]) >> (${BRANCH_SHIFT}u + 2u * a)) & 3u, ${x0('a')}, goal, ${v0('a')}, dt)`,
        }
      : (() => {
          const f = SPRUNG[form];
          if (f === undefined) throw new Error(`blits: no WGSL for motion law ${form}`);
          return {
            helpers: [f.wgsl],
            call: `blits_closed_${f.name}(k, ${x0('a')} - goal, ${v0('a')}, dt)`,
          };
        })();
  return {
    helpers: solve.helpers,
    body: [
      'let dt = max(0.0, t - persub[r]) / 1000.0;',
      'let settle = values[k + 1u];',
      'var still = settle > 0.0;',
      `for (var a = 0u; a < ${n}u; a++) {`,
      `let goal = ${to('a')};`,
      `let yd = ${solve.call};`,
      'x[a] = goal + yd.x;',
      'if (abs(yd.x) > settle || abs(yd.y) > settle) { still = false; }',
      '}',
      `if (still) { for (var a = 0u; a < ${n}u; a++) { x[a] = ${to('a')}; } }`,
    ].join(' '),
  };
}
