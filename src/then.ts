import { type Cut, within } from './cut.js';
import type { Change, Motions, Segment } from './motions.js';

/** Whether `c` was made by frame `cut`; one made with no mix playing its patch was. */
const madeBy = (c: Change, cut: Cut): boolean =>
  c.seq === undefined || Number.isNaN(c.seq) || within(cut, c.seq, c.early === true);

/** The stretch playing at voice time `t` of a run's, oldest first: the latest released by then, else the first. */
function playingIn(list: readonly Segment[], t: number): Segment {
  const last = list[list.length - 1] as Segment;
  if (t >= last.at || list.length === 1) return last;
  if ((list[0] as Segment).at > t) return list[0] as Segment;
  let lo = 0;
  let hi = list.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((list[mid] as Segment).at <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo] as Segment;
}

/**
 * `subject`'s position and velocity at voice time `t`, into the patch's `xs` and `vs`, as frame `cut` left it:
 * in the run it had then, with only the changes made by then, as a seek back there plays it. A run
 * with none made since reads as it stands; one with some plays from its earliest stretch kept,
 * the rest applied again in the order they take effect. Commits nothing, and gives the run's flags.
 */
export function sampleThen<I>(motions: Motions<I>, subject: I, t: number, cut: Cut): number {
  const run = motions.runThen(subject, cut) ?? motions.freshRun(subject);
  let stretches = run.stretches;
  let pending: readonly Change[] = run.pending ?? [];
  const kept: Change[] = [];
  let since = false;
  for (const c of [...stretches.slice(1).map((seg) => seg.change), ...pending])
    if (c === undefined || madeBy(c, cut)) {
      if (c !== undefined) kept.push(c);
    } else since = true;
  if (since) {
    stretches = [stretches[0] as Segment];
    pending = kept
      .filter((c) => c.at !== undefined)
      .sort((a, b) => (a.at as number) - (b.at as number));
  }
  let seg = playingIn(stretches, t);
  for (const c of pending) {
    const a = c.at;
    if (a === undefined || !(a <= t)) break;
    if (a >= seg.at) seg = motions.applied(subject, seg, c, a);
  }
  motions.evaluateSegment(seg, t, motions.xs, motions.vs);
  return run.flags;
}
