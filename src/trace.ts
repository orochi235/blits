import { type Curve, stepsOf, straight } from './easing.js';
import type { Mixer } from './mixer.js';
import type { Bend, NumberChannel, Projection, Run, Trace, TraceOptions } from './types.js';
import type { Voice } from './voice.js';

/**
 * How far inside a sampled stretch its ends are read, ms, but for the window's own: a stretch ends
 * where a voice may jump, and its end is read on its own side of the jump.
 */
const NUDGE = 1e-6;

/** Two values at one time this close are one point, not a jump. */
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * A stretch of mix time a voice's value bends in. With `ease`, the value is one end plus the change
 * times `ease(k0 + k1 · t)`, its argument running 0 to 1 across the stretch; without one, it bends
 * in a way the trace cannot name.
 */
type Bent =
  | readonly [lo: number, hi: number]
  | readonly [lo: number, hi: number, ease: Curve, k0: number, k1: number];

/** The most voices' bends one stretch may fold before it is read on the grid instead. */
const MOST_BENDS = 4;

/**
 * Where the reads that fit a bent stretch fall, as fractions of it: inside, and spread unevenly so
 * an easing that is even about the middle, or steps, cannot look straight at them.
 */
const fitAt = (i: number, n: number): number => (i + 0.3819660113) / (n + 0.7639320225);
/** The fraction of a bent stretch read once more, to check the fit. */
const CHECK = 0.5414213562;

/**
 * What a trace knows of one subject's voices over its window, by slot: the times their shapes bend
 * or jump, the stretches they bend in, the slots a voice of unknown shape writes, and how many
 * voices of known shape write each slot.
 */
interface Plan {
  knots: Map<number, number[]>;
  bent: Map<number, Bent[]>;
  unknown: Set<number>;
  writers: Map<number, number>;
}

/** `mix.trace`: see `Mix.trace`. */
export function traceMix<I, O>(
  mix: Mixer<I, O>,
  from: number,
  to: number,
  opts: TraceOptions = {},
): Trace<I, O> {
  if (!(from <= to) || !Number.isFinite(from) || !Number.isFinite(to))
    throw new RangeError(`blits: a trace runs from a time to one no earlier, not ${from} to ${to}`);
  const grid = opts.grid ?? 5;
  const bending = opts.bends === true;
  if (!(grid > 0 && grid < Number.POSITIVE_INFINITY))
    throw new RangeError(`blits: a trace's grid is a finite number of ms above 0, not ${grid}`);
  const known = knowable(mix, from);
  const projections = new Map<number, Projection<I, O>>();
  const poses = new Map<I, Map<number, O>>();
  const plans = new Map<I, Plan>();

  const poseAt = (subject: I, t: number): O => {
    let mine = poses.get(subject);
    if (mine === undefined) {
      mine = new Map();
      poses.set(subject, mine);
    }
    let pose = mine.get(t);
    if (pose === undefined) {
      let p = projections.get(t);
      if (p === undefined) {
        p = mix.project(t);
        projections.set(t, p);
      }
      pose = p.probe(subject, mix.pose());
      mine.set(t, pose);
    }
    return pose;
  };

  return {
    from,
    to,
    of(subject: I, channel: NumberChannel<O>): Run {
      const name = channel as string;
      const slot = mix.slotOf.get(name);
      if (slot === undefined) throw new Error(`blits: the mix has no channel ${name}`);
      const value = (t: number): number => {
        const v = (poseAt(subject, t) as Record<string, unknown>)[name];
        return typeof v === 'number' ? v : Number.NaN;
      };
      let plan = plans.get(subject);
      if (plan === undefined) {
        plan = planOf(mix, subject, from, to);
        plans.set(subject, plan);
      }
      const op = mix.scalars[slot];
      const shaped =
        known &&
        !plan.unknown.has(slot) &&
        !mix.bounded.includes(slot) &&
        (op === 'sum' || (op === 'mul' && (plan.writers.get(slot) ?? 0) <= 1));
      const bent = plan.bent.get(slot);
      const over = (a: number, b: number): Bent[] =>
        bent === undefined ? [] : bent.filter(([lo, hi]) => lo < b && hi > a);
      if (from === to) {
        const once = { at: [from], value: [value(from)], exact: shaped };
        return bending ? { ...once, bends: [] } : once;
      }

      const at: number[] = [];
      const values: number[] = [];
      const bends: Bend[] = [];
      let exact = true;
      const add = (t: number, v: number): void => {
        const n = at.length;
        if (n > 0 && at[n - 1] === t && close(values[n - 1] as number, v)) values[n - 1] = v;
        else {
          at.push(t);
          values.push(v);
        }
      };
      const knots = [from, ...(plan.knots.get(slot) ?? []), to];
      for (let i = 0; i + 1 < knots.length; i++) {
        const a = knots[i] as number;
        const b = knots[i + 1] as number;
        const curving = shaped ? over(a, b) : null;
        if (curving !== null && curving.length === 0) {
          // Read inside, so a jump at either end is not read; the line reaches each end exactly.
          const t1 = a + (b - a) / 3;
          const t2 = b - (b - a) / 3;
          const v1 = value(t1);
          const slope = (value(t2) - v1) / (t2 - t1);
          add(a, v1 - slope * (t1 - a));
          add(b, v1 + slope * (b - t1));
          continue;
        }
        if (
          bending &&
          curving !== null &&
          curving.length <= MOST_BENDS &&
          curving.every((x) => x[2] !== undefined)
        ) {
          const fit = fitBent(a, b, curving, value);
          if (fit !== null) {
            add(a, fit.va);
            bends.push({ index: at.length - 1, off: fit.off });
            add(b, fit.vb);
            continue;
          }
        }
        exact = false;
        const e = Math.min(NUDGE, (b - a) / 4);
        add(a, value(a === from ? a : a + e));
        for (let k = Math.max(0, Math.ceil((a - from) / grid)); ; k++) {
          const g = from + k * grid;
          if (g >= b - e) break;
          if (g > a + e) add(g, value(g));
        }
        add(b, value(b === to ? b : b - e));
      }
      return bending ? { at, value: values, exact, bends } : { at, value: values, exact };
    },
  };
}

/**
 * Fits a stretch from `a` to `b` where each of `curves` bends the value: a line plus, for each, a
 * multiple of how far its easing stands off its own chord. The value is read at as many points
 * inside as there are unknowns, and once more to check; null where the reads do not pin the fit
 * or the check misses, so the stretch is read on the grid.
 */
function fitBent(
  a: number,
  b: number,
  curves: readonly Bent[],
  value: (t: number) => number,
): { va: number; vb: number; off: (u: number) => number } | null {
  const span = b - a;
  const easedOf = (c: Bent, t: number): number =>
    (c[2] as Curve)(Math.min(1, Math.max(0, (c[3] as number) + (c[4] as number) * t)));
  // A curve that runs straight over this stretch, as one may over part of its own, is no bend here.
  const bowed = curves.filter((c) => {
    const ea = easedOf(c, a);
    const eb = easedOf(c, b);
    for (let i = 0; i < 8; i++) {
      const u = fitAt(i, 8);
      if (Math.abs(easedOf(c, a + u * span) - ea - u * (eb - ea)) > 1e-12) return true;
    }
    return Math.abs(easedOf(c, a + CHECK * span) - ea - CHECK * (eb - ea)) > 1e-12;
  });
  const k = bowed.length;
  const n = k + 2;
  const eased = (j: number, t: number): number => easedOf(bowed[j] as Bent, t);
  const ends = bowed.map((_, j) => [eased(j, a), eased(j, b)] as const);
  // Each curve less its chord over the stretch: 0 at both ends.
  const bow = (j: number, u: number): number => {
    const [ea, eb] = ends[j] as readonly [number, number];
    return eased(j, a + u * span) - ea - u * (eb - ea);
  };
  const row = (u: number): number[] => [1 - u, u, ...bowed.map((_, j) => bow(j, u))];

  const m: number[][] = [];
  const rhs: number[] = [];
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const u = fitAt(i, n);
    const v = value(a + u * span);
    if (!Number.isFinite(v)) return null;
    m.push(row(u));
    rhs.push(v);
    scale = Math.max(scale, Math.abs(v));
  }
  const x = solve(m, rhs);
  if (x === null) return null;
  const off = (u: number): number => {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += (x[2 + j] as number) * bow(j, u);
    return sum;
  };
  const va = x[0] as number;
  const vb = x[1] as number;
  const check = value(a + CHECK * span);
  const fitted = va + (vb - va) * CHECK + off(CHECK);
  if (!(Math.abs(check - fitted) <= 1e-9 * Math.max(1, scale))) return null;
  return { va, vb, off };
}

/** Solves `m x = rhs` by elimination with partial pivoting; null where `m` is near singular. */
function solve(m: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number))
        p = r;
    const pivot = (m[p] as number[])[c] as number;
    if (!(Math.abs(pivot) > 1e-12)) return null;
    [m[c], m[p]] = [m[p] as number[], m[c] as number[]];
    [rhs[c], rhs[p]] = [rhs[p] as number, rhs[c] as number];
    const top = m[c] as number[];
    for (let r = c + 1; r < n; r++) {
      const row = m[r] as number[];
      const f = (row[c] as number) / pivot;
      if (f === 0) continue;
      for (let k = c; k < n; k++) row[k] = (row[k] as number) - f * (top[k] as number);
      rhs[r] = (rhs[r] as number) - f * (rhs[c] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let sum = rhs[r] as number;
    for (let k = r + 1; k < n; k++) sum -= (row[k] as number) * (x[k] as number);
    x[r] = sum / (row[r] as number);
  }
  return x;
}

/**
 * Whether the mix's own state lets a trace know any shape: a window at or after the mix's time,
 * with no recorded call ahead.
 */
function knowable<I, O>(mix: Mixer<I, O>, from: number): boolean {
  const transport = mix.transport;
  if (!(from >= mix.now)) return false;
  const tape = transport.tape;
  return tape === undefined || tape.timestampAt(tape.undoDepth()) === undefined;
}

function planOf<I, O>(mix: Mixer<I, O>, subject: I, from: number, to: number): Plan {
  const plan: Plan = { knots: new Map(), bent: new Map(), unknown: new Set(), writers: new Map() };
  for (const voice of mix.cued) {
    if (voice.state === 'done' || !mix.aims(voice, subject)) continue;
    if (shapeOf(mix, voice, subject, from, to, plan)) continue;
    for (const slot of voice.slots) plan.unknown.add(slot);
  }
  for (const [slot, knots] of plan.knots)
    plan.knots.set(
      slot,
      knots.sort((a, b) => a - b).filter((t, i, all) => i === 0 || t !== all[i - 1]),
    );
  return plan;
}

/** The most breakpoints one voice may add to a window before it is read on the grid instead. */
const MOST = 4096;

/**
 * Adds a voice's breakpoints for one subject to `plan`, and returns true, where its shape is known
 * through the window: a `keys` voice, or a tween with no change to come, on its own clock at a
 * steady rate and a number weight. Returns false, adding nothing, for any other.
 */
function shapeOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  from: number,
  to: number,
  plan: Plan,
): boolean {
  const spec = voice.spec;
  const built = voice.built;
  const patch = voice.patch;
  const motion = voice.motion;
  const tweened = motion !== undefined && motion.ease !== undefined && !motion.round;
  if (!tweened && (patch.form !== 'keys' || built === null)) return false;
  if (patch.step !== undefined) return false;
  if (typeof spec.weight === 'function' || voice.owner !== null || voice.holding !== null)
    return false;
  if (voice.fitting !== null || voice.arc !== null || voice.blend !== null) return false;
  if (spec.anchor !== undefined || spec.role !== undefined || spec.within !== undefined)
    return false;
  if (spec.stepMs !== undefined || spec.from !== undefined) return false;
  // A ramp of the voice's rate over by the window leaves its clock steady through it.
  const ramp = voice.ramp;
  if (ramp !== null && !(voice.anchorNow + ramp.over <= from)) return false;
  if (!((ramp === null ? voice.rate : ramp.to) > 0) || voice.out !== null || voice.back !== null)
    return false;
  if (voice.stalls !== null) return false;
  if (voice.parts !== null || voice.parted !== null || voice.left !== null) return false;
  if (Number.isFinite(voice.outAt) || voice.state === 'fading') return false;
  // Under a mix rate, a waiting voice's start is pinned to the host's clock, where a ramp moves it.
  if (voice.state === 'pending' && mix.transport.pace !== null) return false;

  const knots: number[] = [];
  const bent: Bent[] = [];
  const bentBy = new Map<number, Bent[]>();
  const at = (t: number): void => {
    if (t > from && t < to) knots.push(t);
  };
  const reduced = mix.reduced;
  const held = voice.sharing ? undefined : voice.subjects.get(subject);
  const delay = held?.delay ?? (spec.stagger ? spec.stagger(subject) : 0);
  const time = (raw: number): number => voice.timeAt(raw + delay);
  // The subject's own time on the voice's clock runs straight through the window.
  const e0 = voice.elapsedAt(from) - delay;
  const pace = to > from ? (voice.elapsedAt(to) - delay - e0) / (to - from) : 0;
  /** An easing run from 0 at the subject's own time `r0` to 1 at `r1`. */
  const easeOver = (r0: number, r1: number, ease: Curve): Bent => [
    time(r0),
    time(r1),
    ease,
    (e0 - pace * from - r0) / (r1 - r0),
    pace / (r1 - r0),
  ];

  const fadeIn = reduced ? 0 : (voice.fade.in ?? 0);
  if (fadeIn > 0) {
    // Where its fade in counts from is known only once the subject has met the voice.
    if (held === undefined) return false;
    if (held.shown + fadeIn > from) {
      bent.push([held.shown, held.shown + fadeIn]);
      at(held.shown);
      at(held.shown + fadeIn);
    }
  }

  const duration = voice.duration;
  const span = voice.span;
  at(voice.start);
  at(time(0));
  if (Number.isFinite(span)) at(time(span));
  const ends = voice.endsAt();
  at(ends);
  if (!voice.freezesAfter && Number.isFinite(ends)) {
    const over = reduced ? 0 : Number.isNaN(voice.outOver) ? (voice.fade.out ?? 0) : voice.outOver;
    // Ended before its start, as a seek past its end leaves it, it fades from its start.
    const fades = Math.max(voice.start, ends);
    at(fades);
    if (over > 0) {
      bent.push([fades, fades + over]);
      at(fades + over);
    }
    // It leaves when its latest subject ends, which a subject first met later can move.
    if (spec.stagger !== undefined) bent.push([time(span), Number.POSITIVE_INFINITY]);
  }

  if (tweened) {
    // A tween eases from where its stretch was released to its goal, and holds there.
    const seg = motion.ahead(subject, e0);
    if (seg === undefined || seg.x0.length !== 1) return false;
    const stretch = easeOver(seg.at, seg.at + seg.ms, motion.ease as Curve);
    at(stretch[0]);
    at(stretch[1]);
    if (stretch[1] > from) bent.push(stretch);
  }

  if (duration > 0 && built !== null) {
    const first = Math.max(0, Math.floor((voice.elapsedAt(from) - delay) / duration));
    const last = Math.min(
      Math.ceil(voice.passes) - 1,
      Math.floor((voice.elapsedAt(to) - delay) / duration),
    );
    let stops = 0;
    for (const track of built.tracks) stops += track.all.length + 1;
    if ((last - first + 1) * stops > MOST) return false;
    for (let pass = first; pass <= last; pass++) {
      const base = pass * duration;
      at(time(base));
      at(time(base + duration));
      for (const track of built.tracks) {
        const slot = mix.slotOf.get(track.channel) as number;
        if (track.numbers === null) return false;
        const wait = track.delay;
        if (wait >= duration) continue;
        if (wait > 0) at(time(base + wait));
        let before = Number.NaN;
        for (const pt of track.all) {
          const raw = base + wait + Math.min(1, Math.max(0, pt.at)) * (duration - wait);
          at(time(raw));
          const ease = pt.ease;
          const steps = ease === undefined ? undefined : stepsOf(ease);
          // Steps hold still between their jumps, so each jump is a breakpoint like any other.
          if (!Number.isNaN(before) && steps !== undefined)
            for (let j = 1; j < steps; j++) at(time(before + ((raw - before) * j) / steps));
          else if (!Number.isNaN(before) && !straight(ease) && raw > before) {
            const list = bentBy.get(slot);
            const span = easeOver(before, raw, ease as Curve);
            if (list === undefined) bentBy.set(slot, [span]);
            else list.push(span);
          }
          before = raw;
        }
      }
    }
  }

  for (const slot of voice.slots) {
    const times = plan.knots.get(slot);
    if (times === undefined) plan.knots.set(slot, [...knots]);
    else times.push(...knots);
    plan.writers.set(slot, (plan.writers.get(slot) ?? 0) + 1);
    const mine = [...bent, ...(bentBy.get(slot) ?? [])];
    if (mine.length === 0) continue;
    const list = plan.bent.get(slot);
    if (list === undefined) plan.bent.set(slot, mine);
    else list.push(...mine);
  }
  return true;
}
