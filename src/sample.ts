import { Sampled, unbareLane } from './bare.js';
import { foldNumber } from './channels.js';
import { clampWeight, passAt, weighed } from './clock.js';
import { type Lane, type Laned, Per, type Positions, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Motions } from './motion.js';
import { absent } from './numbers.js';
import { reading } from './reading.js';
import { between, left, progress } from './tweened.js';
import type { Subject } from './voice.js';

/**
 * A motion voice's fill: what `one` and `move` do for each subject, in one loop for the common
 * case, a subject not yet probed this frame with nothing pending, and through `move` for the rest.
 */
export function runMotion<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>, run: Motions<I>): void {
  const voice = lane.voice;
  const data = lane.data;
  const per = lanes.per;
  const list = lane.list;
  const records = lane.records;
  const ch = lane.chans[0] as Laned;
  const fills = lanes.fills;
  const from = lanes.frameProbes;
  const seeks = voice.seeks;
  const elapsedNow = voice.elapsedAt(lanes.now);
  const flat = lane.flat;
  const parts = voice.parts !== null;
  const signal = typeof voice.spec.weight === 'function';
  // On a frame's first fill no probe has read a subject yet, so none needs `move` for that.
  const probed = lanes.probes !== from;
  const whole = clampWeight(voice.weight);
  const n = run.n;
  const op = ch.op;
  if (n > 0) {
    if (lane.axes !== n) {
      lane.axes = n;
      lane.samples = new Float64Array(0);
    }
    if (list.length * n > lane.samples.length) {
      const grown = new Float64Array(Math.max(list.length, (lane.samples.length / n) * 2, 4) * n);
      grown.set(lane.samples);
      lane.samples = grown;
    }
  }
  const samples = lane.samples;
  const xs = run.xs;
  const ease = run.ease;
  // A tween whose stretches tell the lane before they change keeps no sample: see `unbareLane`.
  if (run.watcher === null) {
    run.watcher = lanes;
    run.watchId = voice.id;
  }
  const own = ease !== undefined && !signal && run.watcher === lanes && run.watchId === voice.id;
  const folds = n === ch.axes;
  for (let p = 0; p < list.length; p++) {
    // Its signal just made kept state: no further call this fill, the general path makes them.
    if (signal && voice.keeping) return;
    const slot = list[p] as number;
    const o = p * Row.STRIDE;
    const q = slot * Per.SLOT;
    if (per[q + Per.LANE_FILL] === fills - 1) data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
    const delay = data[o + Row.DELAY] as number;
    const elapsed = elapsedNow - delay;
    if (elapsed < 0) {
      unbareLane(lane, p);
      data[o + Row.WEIGHT] = 0;
      continue;
    }
    if (!flat) {
      const since = data[o + Row.SINCE] as number;
      if (!lane.weighed || !Object.is(since, lane.weighedSince)) {
        lane.fade = lanes.host.envelope(voice, since);
        lane.weighed = true;
        lane.weighedSince = since;
      }
    }
    let w: number;
    if (signal) {
      w = lanes.signalled(
        voice,
        slot,
        records[p] as Subject<unknown>,
        elapsed,
        passAt(elapsed, voice.duration, voice.passes),
        lane.fade,
      );
      if (Number.isNaN(w)) {
        data[o + Row.WEIGHT] = 0;
        continue;
      }
    } else
      w = flat && !parts ? whole : weighed(voice.weight, lane.fade, lanes.parting(voice, slot));
    data[o + Row.WEIGHT] = w;
    if (data[o + Row.MET] === 0) {
      if (Number.isNaN((records[p] as Subject<unknown>).probed)) {
        unbareLane(lane, p);
        lanes.late.push(slot);
        continue;
      }
      data[o + Row.MET] = 1;
    }
    const ms = data[o + Row.MSLOT] as number;
    const b = ms < 0 ? -1 : run.bareAt(ms);
    if (
      b < 0 ||
      (probed &&
        ((per[q + Per.LANE_PROBE] as number) > from ||
          (per[q + Per.GENERAL_PROBE] as number) > from))
    ) {
      move(lanes, lane, run, p, slot, records[p] as Subject<unknown>, elapsed, delay, w);
      continue;
    }
    const runs = run.runs;
    if (own && folds && run.scalar(ms) === ch.scalar) {
      if (data[o + Row.SAMPLED] !== Sampled.BARE) {
        data[o + Row.SAMPLED] = Sampled.BARE;
        lane.deltas[p] = null;
      }
      const share = left(ease, progress(elapsed, runs[b] as number, runs[b + 2] as number));
      if (w <= 0) continue;
      const values = ch.values;
      const base = slot * n;
      const x = b + 3;
      const g = x + 2 * n;
      for (let a = 0; a < n; a++)
        values[base + a] = foldNumber(
          op,
          values[base + a] as number,
          between(runs[x + a] as number, runs[g + a] as number, share),
          w,
        );
      continue;
    }
    if (ease !== undefined) {
      // A tween's closed form, read straight from its run: release time, seconds, `x0`, `to`.
      const share = left(ease, progress(elapsed, runs[b] as number, runs[b + 2] as number));
      const x = b + 3;
      const g = x + 2 * n;
      for (let a = 0; a < n; a++)
        xs[a] = between(runs[x + a] as number, runs[g + a] as number, share);
    } else run.sampleBare(ms, elapsed, xs, run.vs);
    for (let a = 0; a < n; a++) samples[p * n + a] = xs[a] as number;
    if (lane.deltas[p] !== null) lane.deltas[p] = null;
    data[o + Row.SAMPLED] = fills;
    data[o + Row.SEEKS] = seeks;
    if (w <= 0) continue;
    if (folds && run.scalar(ms) === ch.scalar) {
      const values = ch.values;
      const base = slot * n;
      for (let a = 0; a < n; a++)
        values[base + a] = foldNumber(op, values[base + a] as number, xs[a] as number, w);
    } else lanes.foldInto(ch, slot, run.value(ms, xs), w);
  }
  if (own) {
    lane.bareFill = fills;
    lane.bareElapsed = elapsedNow;
    lane.bareSeeks = seeks;
  }
}

/**
 * A motion voice's value for a subject, sampled from the patch's state as its `at` would, but only
 * where that sample changes nothing: one with a change to stamp, commit or let go of goes to the
 * general path, which samples it if and when a probe asks, as it would with no lanes. A probe
 * this frame already read keeps the value it read, as the general path's record would.
 */
export function move<I, O>(
  lanes: Lanes<I, O>,
  lane: Positions<I, O>,
  run: Motions<I>,
  p: number,
  slot: number,
  held: Subject<unknown>,
  elapsed: number,
  delay: number,
  w: number,
): void {
  const voice = lane.voiceAt(p);
  const data = lane.data;
  const o = p * Row.STRIDE;
  const ch = lane.chans[0] as Laned;
  settle(lanes, lane, p, slot, held);
  const delta = held.delta;
  if (
    delta === null ||
    held.probed !== lanes.now ||
    held.seeks !== voice.seeks ||
    !lanes.probedThisFrame(slot)
  ) {
    let ms = data[o + Row.MSLOT] as number;
    if (ms < 0) {
      const subject = lanes.subjectAt(slot);
      if (subject === absent) return;
      ms = run.slot(subject);
      data[o + Row.MSLOT] = ms;
      lane.numbered(p, ms);
    }
    if (lanes.keeps) lanes.host.horizon(voice, delay);
    else reading.horizon = Number.POSITIVE_INFINITY;
    if (!run.quiet(ms, elapsed)) {
      lanes.late.push(slot);
      return;
    }
    run.sample(ms, elapsed, run.xs, run.vs);
    // Kept as numbers, not a delta: one is built only if a probe this frame asks for it.
    const n = run.n;
    lane.keep(p, run.xs, n);
    lane.deltas[p] = null;
    data[o + Row.SAMPLED] = lanes.fills;
    data[o + Row.SEEKS] = voice.seeks;
    if (w <= 0) return;
    // A sample of other axes than the channel's folds as the general path folds it.
    if (n === ch.axes && run.scalar(ms) === ch.scalar) lanes.foldRun(ch, slot, run.xs, w);
    else lanes.foldInto(ch, slot, run.value(ms, run.xs), w);
    return;
  }
  lane.deltas[p] = delta;
  data[o + Row.SAMPLED] = lanes.fills;
  data[o + Row.SEEKS] = voice.seeks;
  if (w > 0) lanes.foldInto(ch, slot, delta[ch.name], w);
}

/** The delta a motion voice's last sample for position `p` made, built from `samples`. */
function sampled<I, O>(lane: Positions<I, O>, p: number): Record<string, unknown> {
  const run = lane.motionAt(p) as Motions<I>;
  lane.kept(p, run.xs);
  const ms = lane.data[p * Row.STRIDE + Row.MSLOT] as number;
  const delta = { [(lane.chans[0] as Laned).name]: run.value(ms, run.xs) };
  lane.deltas[p] = delta;
  return delta;
}

/**
 * A probe this frame read a motion voice's value for the subject from an earlier fill: write onto
 * its record what the general path's sample would have, so a later read this frame reuses it.
 */
export function settle<I, O>(
  lanes: Lanes<I, O>,
  lane: Positions<I, O>,
  p: number,
  slot: number,
  held: Subject<unknown>,
): void {
  lane.fix(p);
  const o = p * Row.STRIDE;
  if (
    (held.probed === lanes.now && held.seeks === lane.data[o + Row.SEEKS]) ||
    !((lanes.per[slot * Per.SLOT + Per.LANE_PROBE] as number) > lanes.frameProbes) ||
    lane.data[o + Row.SAMPLED] !== lanes.per[slot * Per.SLOT + Per.LANE_FILL]
  )
    return;
  held.delta = lane.deltas[p] ?? sampled(lane, p);
  held.probed = lanes.now;
  held.seeks = lane.data[o + Row.SEEKS] as number;
}
