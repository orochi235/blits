import { foldNumber } from './channels.js';
import { bare, type Crowd, Hot } from './crowd.js';
import type { Curve } from './easing.js';
import { type Lane, type Laned, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Motions } from './motions.js';
import { between, left, progress } from './tweened.js';

/**
 * `Row.SAMPLED` of a crowd row sampled bare in every fill that ran its crowd since it was set, so
 * its sample is the one `unbare` works out from `hot` at `Crowd.bareNow` rather than a copy.
 */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum Sampled {
  BARE = -2,
}

/** A `Flag.FAST` row's voice time at `now`, before its delay. */
export function clock(hot: Float64Array, h: number, now: number): number {
  return (
    (hot[h + Hot.ELAPSED] as number) +
    (now - (hot[h + Hot.NOW] as number)) * (hot[h + Hot.RATE] as number)
  );
}

/**
 * A crowd's rows from `p` on that are tweens with nothing on the voice or the stretch for
 * `runCrowd` to look at, sampled from `hot` and folded straight in, up to voice `id`; returns the
 * first row it leaves to `runCrowd`. A row's sample is not kept: `unbare` works it out again when
 * something asks for it.
 */
export function bareRows<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, p: number, id: number): number {
  const data = c.data;
  const hot = c.hot;
  const H = c.stride;
  const per = lanes.per;
  const list = c.list;
  const ch = c.chans[0] as Laned;
  const n = c.axes;
  const fills = lanes.fills;
  const from = lanes.frameProbes;
  const probed = lanes.probes !== from;
  const now = lanes.now;
  const op = ch.op;
  for (; p < list.length; p++) {
    const h = p * H;
    if ((hot[h + Hot.ID] as number) >= id || !bare(hot[h + Hot.FLAGS] as number)) break;
    const o = p * Row.STRIDE;
    if ((data[o + Row.MSLOT] as number) < 0 || data[o + Row.MET] === 0) break;
    const slot = list[p] as number;
    const q = slot * Per.SLOT;
    if (
      probed &&
      ((per[q + Per.LANE_PROBE] as number) > from || (per[q + Per.GENERAL_PROBE] as number) > from)
    )
      break;
    const elapsed = clock(hot, h, now) - (data[o + Row.DELAY] as number);
    if (!(elapsed >= 0)) break;
    if (per[q + Per.LANE_FILL] === fills - 1) data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
    const w = hot[h + Hot.WEIGHT] as number;
    data[o + Row.WEIGHT] = w;
    if (data[o + Row.SAMPLED] !== Sampled.BARE) {
      data[o + Row.SAMPLED] = Sampled.BARE;
      c.deltas[p] = null;
    }
    if (w <= 0) continue;
    const share = left(
      c.eases[p] as Curve,
      progress(elapsed, hot[h + Hot.AT] as number, hot[h + Hot.MS] as number),
    );
    const values = ch.values;
    const base = slot * n;
    const x = h + Hot.X0;
    const g = x + 2 * n;
    for (let a = 0; a < n; a++)
      values[base + a] = foldNumber(
        op,
        values[base + a] as number,
        between(hot[x + a] as number, hot[g + a] as number, share),
        w,
      );
  }
  return p;
}

/**
 * Keeps the sample a `Sampled.BARE` row was last given, worked out from `hot` as `bareRows` did,
 * before `hot` changes or something reads it; nothing for any other row.
 */
export function unbare<I, O>(c: Crowd<I, O>, p: number): void {
  const o = p * Row.STRIDE;
  const data = c.data;
  if (data[o + Row.SAMPLED] !== Sampled.BARE) return;
  const hot = c.hot;
  const h = p * c.stride;
  const n = c.axes;
  const elapsed = clock(hot, h, c.bareNow) - (data[o + Row.DELAY] as number);
  const share = left(
    c.eases[p] as Curve,
    progress(elapsed, hot[h + Hot.AT] as number, hot[h + Hot.MS] as number),
  );
  const x = h + Hot.X0;
  const g = x + 2 * n;
  for (let a = 0; a < n; a++)
    c.samples[p * n + a] = between(hot[x + a] as number, hot[g + a] as number, share);
  data[o + Row.SAMPLED] = c.bareFill;
  data[o + Row.SEEKS] = hot[h + Hot.SEEKS] as number;
}

/**
 * `unbare` for a lane position: its sample worked out again from its patch's stretch, which tells
 * the lane through `stretchChanged` before it changes.
 */
export function unbareLane<I, O>(lane: Lane<I, O>, p: number): void {
  const o = p * Row.STRIDE;
  const data = lane.data;
  if (data[o + Row.SAMPLED] !== Sampled.BARE) return;
  const run = lane.motion as Motions<I>;
  const runs = run.runs;
  const n = run.n;
  const b = run.base(data[o + Row.MSLOT] as number);
  const elapsed = lane.bareElapsed - (data[o + Row.DELAY] as number);
  const share = left(
    run.ease as Curve,
    progress(elapsed, runs[b] as number, runs[b + 2] as number),
  );
  const x = b + 3;
  const g = x + 2 * n;
  for (let a = 0; a < n; a++)
    lane.samples[p * n + a] = between(runs[x + a] as number, runs[g + a] as number, share);
  data[o + Row.SAMPLED] = lane.bareFill;
  data[o + Row.SEEKS] = lane.bareSeeks;
}
