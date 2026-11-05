import type { Mixer } from './mixer.js';
import { type Bent, bowsOver, fitBent } from './trace-fit.js';
import { type Plan, planOf } from './trace-plan.js';
import type { Bend, NumberChannel, Projection, Run, Trace, TraceOptions } from './types.js';

/**
 * How far inside a sampled stretch its ends are read, ms, but for the window's own: a stretch ends
 * where a voice may jump, and its end is read on its own side of the jump.
 */
const NUDGE = 1e-6;

/** Two values at one time this close are one point, not a jump. */
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** The most bends one stretch may fit, each a read, before it is read on the grid instead. */
const MOST_BENDS = 8;

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
      // A bend meeting a stretch only within rounding of its end does not bend it.
      const over = (a: number, b: number): Bent[] => {
        if (bent === undefined) return [];
        const slack = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
        return bent.filter(([lo, hi]) => lo < b - slack && hi > a + slack);
      };
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
        const bows = shaped ? bowsOver(a, b, over(a, b)) : null;
        if (bows !== null && bows.length === 0) {
          // Read inside, so a jump at either end is not read; the line reaches each end exactly.
          const t1 = a + (b - a) / 3;
          const t2 = b - (b - a) / 3;
          const v1 = value(t1);
          const slope = (value(t2) - v1) / (t2 - t1);
          add(a, v1 - slope * (t1 - a));
          add(b, v1 + slope * (b - t1));
          continue;
        }
        // A stretch that could bend but fits a line is a line, bends asked for or not.
        const fit = bows !== null && bows.length <= MOST_BENDS ? fitBent(a, b, bows, value) : null;
        if (fit !== null && (bending || fit.flat)) {
          add(a, fit.va);
          if (!fit.flat) bends.push({ index: at.length - 1, off: fit.off });
          add(b, fit.vb);
          continue;
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
 * Whether the mix's own state lets a trace know any shape: a window at or after the mix's time,
 * with no recorded call ahead.
 */
function knowable<I, O>(mix: Mixer<I, O>, from: number): boolean {
  const transport = mix.transport;
  if (!(from >= mix.now)) return false;
  const tape = transport.tape;
  return tape === undefined || tape.timestampAt(tape.undoDepth()) === undefined;
}
