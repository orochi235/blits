// The one workload every variant folds, and the two CPU variants: the real mix from dist/, and a
// dense struct-of-arrays loop with the same fold rules.
import { keys, kit, max, mix, mul, sum, vec } from '../../dist/index.js';

export const CHANNELS = 5; // gain, dark, position x/y/z, in that order in every pose buffer

const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()) });

// The CSS named curves as blits defines them in src/easing.ts.
const NAMED = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};
const NAMES = Object.keys(NAMED);
const BEZIERS = [
  [0.3, 0, 0.2, 1],
  [0.7, -0.2, 0.3, 1.3],
  [0.1, 0.6, 0.4, 0.9],
];

/** Voice v's data: period, fade, weight, three stops, and the easing into stops 1 and 2. */
export function voiceData(v) {
  const in1 = NAMES[v % NAMES.length];
  const in2 = BEZIERS[v % BEZIERS.length];
  return {
    period: 900 + 230 * v,
    fadeIn: 250 + 50 * v,
    fadeEase: 'ease-out',
    weight: v % 3 === 2 ? 0.6 : 1,
    gain: [1, 0.3 + 0.05 * v, 1.1],
    dark: [0, 0.2 + 0.07 * v, 0.05],
    position: [
      [0, 0, 0],
      [5 - v, 2 + 0.5 * v, 0.3 * v],
      [0.5, -1, 0.25 * v],
    ],
    ease1: { name: in1, bezier: NAMED[in1] },
    ease2: { bezier: in2 },
  };
}

/** Per-subject delay in ms for voice v: whole numbers, so float32 holds them exactly. */
export const stagger = (i, v) => (i * 7919 + v * 104729) % 600;

/** Every voice's delay for every subject, voice-major: delays[v * n + i]. */
export function delays(n, voices) {
  const d = new Float32Array(n * voices);
  for (let v = 0; v < voices; v++) for (let i = 0; i < n; i++) d[v * n + i] = stagger(i, v);
  return d;
}

// ---- variant 1: the real mix ----

export function makeMix(voices, subjects) {
  const m = mix(K);
  for (let v = 0; v < voices; v++) {
    const d = voiceData(v);
    const p = keys(d.period, [
      { at: 0, delta: { gain: d.gain[0], dark: d.dark[0], position: d.position[0] } },
      {
        at: 0.5,
        delta: { gain: d.gain[1], dark: d.dark[1], position: d.position[1] },
        ease: d.ease1.name,
      },
      {
        at: 1,
        delta: { gain: d.gain[2], dark: d.dark[2], position: d.position[2] },
        ease: { bezier: d.ease2.bezier },
      },
    ]);
    m.cue({
      patch: p,
      start: 0,
      weight: d.weight,
      fade: { in: d.fadeIn, ease: d.fadeEase },
      stagger: (s) => stagger(s.i, v),
    });
  }
  return m;
}

/** Reads a probed pose into the flat channel order every other variant writes. */
export function flat(pose, into, at = 0) {
  into[at] = pose.gain;
  into[at + 1] = pose.dark;
  into[at + 2] = pose.position[0];
  into[at + 3] = pose.position[1];
  into[at + 4] = pose.position[2];
  return into;
}

// ---- variant 2: dense CPU ----

/** blits' cubic-bezier solve, src/easing.ts, unrolled onto plain coefficients. */
export function bezierAt(x1, y1, x2, y2, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  let t = u;
  for (let i = 0; i < 8; i++) {
    const err = ((ax * t + bx) * t + cx) * t - u;
    if (Math.abs(err) < 1e-7) return ((ay * t + by) * t + cy) * t;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = u;
  while (hi - lo > 1e-7) {
    if (((ax * t + bx) * t + cx) * t < u) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

/**
 * Voice data flattened to one Float64Array row per voice, the same layout the GPU buffer takes:
 * [period, fadeIn, start, _, g0 g1 g2, d0 d1 d2, x0 x1 x2, y0 y1 y2, z0 z1 z2, e1(4), e2(4), fade(4)]
 */
export const STRIDE = 32;
export function packVoices(voices) {
  const out = new Float64Array(voices * STRIDE);
  for (let v = 0; v < voices; v++) {
    const d = voiceData(v);
    const o = v * STRIDE;
    out.set([d.period, d.fadeIn, 0, 0], o);
    out.set(d.gain, o + 4);
    out.set(d.dark, o + 7);
    for (let k = 0; k < 3; k++)
      for (let axis = 0; axis < 3; axis++) out[o + 10 + axis * 3 + k] = d.position[k][axis];
    out.set(d.ease1.bezier, o + 19);
    out.set(d.ease2.bezier, o + 23);
    out.set(NAMED[d.fadeEase], o + 27);
  }
  return out;
}

export function dense(n, voices) {
  const vd = packVoices(voices);
  const delay = delays(n, voices);
  const pose = new Float32Array(CHANNELS * n);
  const weights = new Float64Array(voices);
  for (let v = 0; v < voices; v++) weights[v] = voiceData(v).weight;
  return {
    pose,
    frame(now) {
      pose.fill(1, 0, n);
      pose.fill(0, n);
      for (let v = 0; v < voices; v++) {
        const o = v * STRIDE;
        const inv = 1 / vd[o];
        const fadeIn = vd[o + 1];
        const start = vd[o + 2];
        const base = now - start;
        const vw = weights[v];
        const dv = v * n;
        for (let i = 0; i < n; i++) {
          const elapsed = base - delay[dv + i];
          if (elapsed < 0) continue;
          let w = vw;
          const fu = elapsed / fadeIn;
          if (fu < 1) w *= bezierAt(vd[o + 27], vd[o + 28], vd[o + 29], vd[o + 30], fu);
          if (w <= 0) continue;
          if (w > 1) w = 1;
          // Not `%`: V8 calls out for a float modulo, and it was a quarter of the loop.
          let phase = elapsed * inv;
          phase -= Math.floor(phase);
          // Three stops at 0, 0.5 and 1: which segment, and how far along it, eased into its end.
          let a;
          let u;
          if (phase <= 0.5) {
            a = 0;
            u = bezierAt(vd[o + 19], vd[o + 20], vd[o + 21], vd[o + 22], phase / 0.5);
          } else {
            a = 1;
            u = bezierAt(vd[o + 23], vd[o + 24], vd[o + 25], vd[o + 26], (phase - 0.5) / 0.5);
          }
          const g = vd[o + 4 + a] + (vd[o + 5 + a] - vd[o + 4 + a]) * u;
          const dk = vd[o + 7 + a] + (vd[o + 8 + a] - vd[o + 7 + a]) * u;
          const x = vd[o + 10 + a] + (vd[o + 11 + a] - vd[o + 10 + a]) * u;
          const y = vd[o + 13 + a] + (vd[o + 14 + a] - vd[o + 13 + a]) * u;
          const z = vd[o + 16 + a] + (vd[o + 17 + a] - vd[o + 16 + a]) * u;
          pose[i] *= 1 + (g - 1) * w;
          const dw = dk * w;
          if (dw > pose[n + i]) pose[n + i] = dw;
          pose[2 * n + i] += x * w;
          pose[3 * n + i] += y * w;
          pose[4 * n + i] += z * w;
        }
      }
      return pose;
    },
  };
}
