import { straight } from './easing.js';
import type { Mixer } from './mixer.js';
import type { NumberChannel, Projection, Run, Trace, TraceOptions } from './types.js';
import type { Voice } from './voice.js';

/**
 * How far inside a sampled stretch its ends are read, ms: a stretch ends where a voice may jump,
 * and its end is read on its own side of the jump.
 */
const NUDGE = 1e-6;

/** Two values at one time this close are one point, not a jump. */
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * What a trace knows of one subject's voices over its window, by slot: the times their shapes bend
 * or jump, the stretches they bend in, the slots a voice of unknown shape writes, and how many
 * voices of known shape write each slot.
 */
interface Plan {
  knots: Map<number, number[]>;
  bent: Map<number, [number, number][]>;
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
      const straightOver = (a: number, b: number): boolean =>
        shaped && (bent === undefined || bent.every(([lo, hi]) => !(lo < b && hi > a)));
      if (from === to) return { at: [from], value: [value(from)], exact: shaped };

      const at: number[] = [];
      const values: number[] = [];
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
        if (straightOver(a, b)) {
          // Read inside, so a jump at either end is not read; the line reaches each end exactly.
          const t1 = a + (b - a) / 3;
          const t2 = b - (b - a) / 3;
          const v1 = value(t1);
          const slope = (value(t2) - v1) / (t2 - t1);
          add(a, v1 - slope * (t1 - a));
          add(b, v1 + slope * (b - t1));
          continue;
        }
        exact = false;
        const e = Math.min(NUDGE, (b - a) / 4);
        add(a, value(a + e));
        for (let k = Math.max(0, Math.ceil((a - from) / grid)); ; k++) {
          const g = from + k * grid;
          if (g >= b - e) break;
          if (g > a + e) add(g, value(g));
        }
        add(b, value(b - e));
      }
      return { at, value: values, exact };
    },
  };
}

/**
 * Whether the mix's own state lets a trace know any shape: a window at or after the mix's time,
 * with no recorded call ahead and no pace that would move its voices.
 */
function knowable<I, O>(mix: Mixer<I, O>, from: number): boolean {
  const transport = mix.transport;
  if (!(from >= mix.now) || transport.pace !== null) return false;
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
 * through the window: a `keys` voice on its own clock at a steady rate and a number weight. Returns
 * false, adding nothing, for any other.
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
  if (patch.form !== 'keys' || built === null || patch.step !== undefined) return false;
  if (typeof spec.weight === 'function' || voice.owner !== null || voice.holding !== null)
    return false;
  if (voice.fitting !== null || voice.arc !== null || voice.blend !== null) return false;
  if (spec.anchor !== undefined || spec.role !== undefined || spec.within !== undefined)
    return false;
  if (spec.stepMs !== undefined || spec.from !== undefined) return false;
  if (voice.ramp !== null || !(voice.rate > 0) || voice.out !== null || voice.back !== null)
    return false;
  if (voice.parts !== null || voice.parted !== null || voice.left !== null) return false;
  if (Number.isFinite(voice.outAt) || voice.state === 'fading') return false;

  const knots: number[] = [];
  const bent: [number, number][] = [];
  const bentBy = new Map<number, [number, number][]>();
  const at = (t: number): void => {
    if (t > from && t < to) knots.push(t);
  };
  const reduced = mix.reduced;
  const held = voice.sharing ? undefined : voice.subjects.get(subject);
  const delay = held?.delay ?? (spec.stagger ? spec.stagger(subject) : 0);
  const time = (raw: number): number => voice.timeAt(raw + delay);

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
    if (over > 0) {
      bent.push([ends, ends + over]);
      at(ends + over);
    }
    // It leaves when its latest subject ends, which a subject first met later can move.
    if (spec.stagger !== undefined) bent.push([time(span), Number.POSITIVE_INFINITY]);
  }

  if (duration > 0) {
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
          const t = time(base + wait + Math.min(1, Math.max(0, pt.at)) * (duration - wait));
          at(t);
          if (!Number.isNaN(before) && !straight(pt.ease)) {
            const list = bentBy.get(slot);
            if (list === undefined) bentBy.set(slot, [[before, t]]);
            else list.push([before, t]);
          }
          before = t;
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
