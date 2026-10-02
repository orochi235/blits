// weasel's animator workload: N nodes each animating { x, y } by a tween or a spring, in two shapes,
// as the real mix and as dense loops. Mirrors weasel's tests/perf/bench/animator-on-blits.bench.ts.
import { kit, mix, patch, spring, sum, vec } from '../../dist/index.js';

const K = kit({ pos: vec(2, sum()) });
/** Long enough that no timed run finishes a tween, short enough that the checks see it move. */
export const TWEEN_MS = 60_000;
/** weasel's: undamped, so nothing comes to rest. */
export const SPRING = { stiffness: 1, damping: 0, mass: 1 };
/** weasel's `easeOut` (@weasel-js/geom), which is its `easeOutQuad`. */
export const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** weasel's endpoints: node i runs from (i, −i) to (i + 500, 300 − i). */
export function nodes(n) {
  const ids = [];
  const from = [];
  const to = [];
  for (let i = 0; i < n; i++) {
    ids.push(`n${i}`);
    from.push({ x: i, y: -i });
    to.push({ x: i + 500, y: 300 - i });
  }
  return { ids, from, to };
}

/** The one-voice fn, given the subject's index: what a host would write, closure and all. */
const tweenAt = (c) => (phase, i) => {
  const a = c.from[i];
  const b = c.to[i];
  const u = easeOut(phase);
  return { pos: [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u] };
};
/** The voice-per-node fn: endpoints captured, subject unused. */
const tweenOf = (a, b) => (phase) => {
  const u = easeOut(phase);
  return { pos: [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u] };
};

// ---- the real mix ----

/**
 * A mix animating the nodes at `idx` (all of them for timing, a sample for checks), cued the way
 * weasel's bench cues them. `velocity(k, t)` reads the spring's velocity for idx[k] at voice time t.
 */
export function makeMotionMix(kind, shape, c, idx) {
  const m = mix(K);
  m.sync(0);
  const ids = idx.map((i) => c.ids[i]);
  const springs = [];
  if (kind === 'tween' && shape === 'one') {
    const index = new Map(c.ids.map((id, i) => [id, i]));
    const at = tweenAt(c);
    m.cue({
      patch: patch(TWEEN_MS, (phase, id) => at(phase, index.get(id)), { writes: ['pos'] }),
      loop: false,
    });
  } else if (kind === 'tween') {
    for (const i of idx)
      m.cue({
        patch: patch(TWEEN_MS, tweenOf(c.from[i], c.to[i]), { writes: ['pos'] }),
        subjects: [c.ids[i]],
        loop: false,
      });
  } else if (shape === 'one') {
    const index = new Map(c.ids.map((id, i) => [id, i]));
    const pt = (pts) => (id) => {
      const p = pts[index.get(id)];
      return [p.x, p.y];
    };
    const sp = spring('pos', { from: pt(c.from), to: pt(c.to), ...SPRING, settle: 0 });
    m.cue({ patch: sp });
    for (let k = 0; k < idx.length; k++) springs.push(sp);
  } else {
    for (const i of idx) {
      const a = c.from[i];
      const b = c.to[i];
      const sp = spring('pos', { from: [a.x, a.y], to: [b.x, b.y], ...SPRING, settle: 0 });
      m.cue({ patch: sp, subjects: [c.ids[i]] });
      springs.push(sp);
    }
  }
  return {
    m,
    ids,
    velocity: (k, t) => springs[k].read(ids[k], t)?.velocity,
  };
}

// ---- dense ----
//
// Poses are Float64Array, x then y: [x0..xn-1, y0..yn-1]. Coordinates reach 1e5 at N = 100k, where
// float32 would round by ~0.004. One voice reaches every subject; a voice per node is modeled as V = N
// voices, each with its own start, period and endpoints, writing through a subject index (subj[v]),
// so the loop runs over voices and scatters into the pose, the way a sparse voice list would.

/** Voice v reaches subject subj[v]; here v = i, but the loop reads it through the array. */
const identity = (n) => Int32Array.from({ length: n }, (_, i) => i);

export function denseTween(c, n, shape, form) {
  const pose = new Float64Array(2 * n);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    fx[i] = c.from[i].x;
    fy[i] = c.from[i].y;
    tx[i] = c.to[i].x;
    ty[i] = c.to[i].y;
  }
  const weight = new Float64Array(shape === 'one' ? 1 : n).fill(1);

  if (shape === 'one') {
    const start = 0;
    const period = TWEEN_MS;
    const at = tweenAt(c);
    const w = weight[0];
    const frame =
      form === 'fn'
        ? (now) => {
            pose.fill(0);
            const elapsed = now - start;
            if (elapsed < 0) return pose;
            const phase = elapsed >= period ? 1 : elapsed / period;
            for (let i = 0; i < n; i++) {
              const p = at(phase, i).pos;
              pose[i] += p[0] * w;
              pose[n + i] += p[1] * w;
            }
            return pose;
          }
        : (now) => {
            pose.fill(0);
            const elapsed = now - start;
            if (elapsed < 0) return pose;
            const phase = elapsed >= period ? 1 : elapsed / period;
            for (let i = 0; i < n; i++) {
              const u = 1 - (1 - phase) * (1 - phase);
              pose[i] += (fx[i] + (tx[i] - fx[i]) * u) * w;
              pose[n + i] += (fy[i] + (ty[i] - fy[i]) * u) * w;
            }
            return pose;
          };
    return { pose, frame };
  }

  const subj = identity(n);
  const start = new Float64Array(n);
  const period = new Float64Array(n).fill(TWEEN_MS);
  const fns = form === 'fn' ? c.from.map((a, v) => tweenOf(a, c.to[v])) : null;
  const frame =
    form === 'fn'
      ? (now) => {
          pose.fill(0);
          for (let v = 0; v < n; v++) {
            const elapsed = now - start[v];
            if (elapsed < 0) continue;
            const phase = elapsed >= period[v] ? 1 : elapsed / period[v];
            const s = subj[v];
            const p = fns[v](phase, s).pos;
            pose[s] += p[0] * weight[v];
            pose[n + s] += p[1] * weight[v];
          }
          return pose;
        }
      : (now) => {
          pose.fill(0);
          for (let v = 0; v < n; v++) {
            const elapsed = now - start[v];
            if (elapsed < 0) continue;
            const phase = elapsed >= period[v] ? 1 : elapsed / period[v];
            const u = 1 - (1 - phase) * (1 - phase);
            const s = subj[v];
            pose[s] += (fx[v] + (tx[v] - fx[v]) * u) * weight[v];
            pose[n + s] += (fy[v] + (ty[v] - fy[v]) * u) * weight[v];
          }
          return pose;
        };
  return { pose, frame };
}

/**
 * blits' spring (src/motion.ts), underdamped branch, in typed arrays. Each subject (or voice) holds
 * the stretch it is on: released at segAt (voice ms) from x0 moving at v0 toward to, per axis. With
 * no retarget these never change; a retarget would evaluate here and rewrite them.
 */
export function denseSpring(c, n, shape) {
  const k = SPRING.stiffness;
  const damp = SPRING.damping;
  const mass = SPRING.mass;
  const w0 = Math.sqrt(k / mass);
  const zeta = damp / (2 * Math.sqrt(k * mass));
  if (!(zeta < 1)) throw new Error('only the underdamped branch is ported');
  const zw = zeta * w0;
  const wd = w0 * Math.sqrt(1 - zeta * zeta);

  const pose = new Float64Array(2 * n);
  const vel = new Float64Array(2 * n);
  const segAt = new Float64Array(n);
  const x0 = new Float64Array(2 * n);
  const v0 = new Float64Array(2 * n);
  const to = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    x0[i] = c.from[i].x;
    x0[n + i] = c.from[i].y;
    to[i] = c.to[i].x;
    to[n + i] = c.to[i].y;
  }
  const per = shape !== 'one';
  const subj = identity(n);
  const start = new Float64Array(per ? n : 1);
  const weight = new Float64Array(per ? n : 1).fill(1);

  const frame = (now) => {
    pose.fill(0);
    for (let v = 0; v < n; v++) {
      const elapsed = now - start[per ? v : 0];
      if (elapsed < 0) continue;
      const w = weight[per ? v : 0];
      const s = per ? subj[v] : v;
      const t = Math.max(0, elapsed - segAt[v]) / 1000;
      const e = Math.exp(-zw * t);
      const cos = Math.cos(wd * t);
      const sin = Math.sin(wd * t);
      for (let a = 0; a < 2; a++) {
        const j = a * n + v;
        const y0 = x0[j] - to[j];
        const b = (v0[j] + zw * y0) / wd;
        const y = e * (y0 * cos + b * sin);
        vel[a * n + s] = -zw * y + e * wd * (b * cos - y0 * sin);
        pose[a * n + s] += (to[j] + y) * w;
      }
    }
    return pose;
  };
  return { pose, vel, frame };
}
