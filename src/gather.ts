import { foldNumber, lerpNumber } from './channels.js';
import { Arg, type Lane, type Laned, type Locus, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Subject } from './voice.js';

/** `xs`, or a copy at least `n` long where it is shorter. */
function sized(xs: Float64Array, n: number): Float64Array {
  if (xs.length >= n) return xs;
  const grown = new Float64Array(n);
  grown.set(xs);
  return grown;
}

/**
 * Every member of a locus, in voice order, gathered rather than folded: a member's delta for a
 * subject is lerped into what the members before it left there by its share of the weight
 * taken, as the general path's `foldLocus` does, so each subject's locus can fold in at its
 * first member's place in the order.
 */
export function gatherLocus<I, O>(lanes: Lanes<I, O>, g: Locus<I, O>): void {
  const cap = lanes.cap;
  if (g.met.length < cap) {
    g.met = sized(g.met, cap);
    g.first = sized(g.first, cap);
    g.sum = sized(g.sum, cap);
  }
  for (let k = 0; k < g.values.length; k++) {
    const values = g.values[k];
    const taken = g.taken[k];
    const axes = (lanes.laned[k] as Laned).axes;
    if (values !== undefined) g.values[k] = sized(values, cap * axes);
    if (taken !== undefined) g.taken[k] = sized(taken, cap);
  }
  lanes.into = g;
  try {
    for (const lane of g.members) {
      const voice = lane.voice;
      if (lane.idle || voice.state === 'pending' || voice.state === 'done') continue;
      lanes.intoId = voice.id;
      lanes.reset(lane);
      lane.elapsedNow = voice.elapsedAt(lanes.now);
      const list = lane.list;
      for (let p = 0; p < list.length; p++) {
        const slot = list[p] as number;
        if (lanes.one(lane, p, slot)) {
          meetLocus(lanes, g, slot);
          g.sum[slot] =
            (g.sum[slot] as number) + (lane.data[p * Row.STRIDE + Row.WEIGHT] as number);
        }
        if (voice.keeping) break;
      }
    }
  } finally {
    lanes.into = null;
  }
}

/** The first a fill hears of a subject in a locus: from the member now gathering. */
function meetLocus<I, O>(lanes: Lanes<I, O>, g: Locus<I, O>, slot: number): void {
  if (g.met[slot] === lanes.fills) return;
  g.met[slot] = lanes.fills;
  g.first[slot] = lanes.intoId;
  g.sum[slot] = 0;
  for (const taken of g.taken) if (taken !== undefined) taken[slot] = 0;
}

/** A member's value for one channel of a subject, lerped into its locus: `foldLocus`'s step. */
function gatherInto<I, O>(
  lanes: Lanes<I, O>,
  g: Locus<I, O>,
  ch: Laned,
  slot: number,
  value: unknown,
): void {
  const w = lanes.arg[Arg.WEIGHT] as number;
  meetLocus(lanes, g, slot);
  const k = ch.index;
  let values = g.values[k];
  let takenAt = g.taken[k];
  if (values === undefined || takenAt === undefined) {
    values = new Float64Array(lanes.cap * ch.axes);
    takenAt = new Float64Array(lanes.cap);
    g.values[k] = values;
    g.taken[k] = takenAt;
  }
  const taken = takenAt[slot] as number;
  const total = taken + w;
  const u = w / total;
  if (ch.scalar) {
    values[slot] =
      taken === 0 ? (value as number) : lerpNumber(values[slot] as number, value as number, u);
  } else {
    // Read past its end as the rest, as `vec`'s lerp and fold both read an array.
    const arr =
      Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>) : null;
    const base = slot * ch.axes;
    for (let a = 0; a < ch.axes; a++) {
      const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
      values[base + a] = taken === 0 ? v : lerpNumber(values[base + a] as number, v, u);
    }
  }
  takenAt[slot] = total;
}

/** A locus member's turn in the order: each subject it was the first member of takes the locus. */
export function foldLocus<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>, g: Locus<I, O>): void {
  const id = lane.voice.id;
  const fills = lanes.fills;
  const list = lane.list;
  for (let p = 0; p < list.length; p++) {
    const slot = list[p] as number;
    if (g.met[slot] !== fills || g.first[slot] !== id) continue;
    const sum = g.sum[slot] as number;
    if (sum <= 0) continue;
    for (let k = 0; k < g.values.length; k++) {
      const takenAt = g.taken[k];
      const taken = takenAt === undefined ? 0 : (takenAt[slot] as number);
      if (!(taken > 0)) continue;
      // A channel folds at the weight of the members that wrote it, not the whole locus.
      const w = taken > 1 ? 1 : taken;
      const ch = lanes.laned[k] as Laned;
      const values = g.values[k] as Float64Array;
      const into = ch.values;
      const base = slot * ch.axes;
      for (let a = 0; a < ch.axes; a++)
        into[base + a] = foldNumber(ch.op, into[base + a] as number, values[base + a] as number, w);
    }
  }
}

/** For a keys voice: the delta's value for each channel it writes, read once per phase. */
export function gather<I, O>(
  this: Lanes<I, O>,
  lane: Lane<I, O>,
  delta: Record<string, unknown>,
): void {
  const chans = lane.chans;
  for (let i = 0; i < chans.length; i++) lane.values[i] = delta[(chans[i] as Laned).name];
}

/** Folds what `gather` read into a subject's laned values, at `Arg.WEIGHT`. */
export function fold<I, O>(this: Lanes<I, O>, lane: Lane<I, O>, slot: number): void {
  const chans = lane.chans;
  for (let i = 0; i < chans.length; i++) this.foldInto(chans[i] as Laned, slot, lane.values[i]);
}

/**
 * Folds a delta a patch returned into a subject's laned values, at `Arg.WEIGHT`. The first few
 * channels are read at a site of their own, which in most mixes sees one channel name and stays
 * fast, where one site reading every name in turn slows every read.
 */
export function foldDelta<I, O>(
  this: Lanes<I, O>,
  chans: readonly Laned[],
  slot: number,
  delta: Record<string, unknown>,
): void {
  const n = chans.length;
  let ch = chans[0] as Laned;
  if (n > 0) this.foldInto(ch, slot, delta[ch.name]);
  ch = chans[1] as Laned;
  if (n > 1) this.foldInto(ch, slot, delta[ch.name]);
  ch = chans[2] as Laned;
  if (n > 2) this.foldInto(ch, slot, delta[ch.name]);
  for (let i = 3; i < n; i++) {
    ch = chans[i] as Laned;
    this.foldInto(ch, slot, delta[ch.name]);
  }
}

/** Folds a motion sample's axes, kept apart from `foldInto` so neither reads two array kinds. */
export function foldRun<I, O>(this: Lanes<I, O>, ch: Laned, slot: number, xs: Float64Array): void {
  const w = this.arg[Arg.WEIGHT] as number;
  const values = ch.values;
  const base = slot * ch.axes;
  for (let a = 0; a < ch.axes; a++)
    values[base + a] = foldNumber(ch.op, values[base + a] as number, xs[a] as number, w);
}

/** Folds one channel's value into a subject's laned values, or its locus, at `Arg.WEIGHT`. */
export function foldInto<I, O>(this: Lanes<I, O>, ch: Laned, slot: number, value: unknown): void {
  if (value === undefined) return;
  if (this.into !== null) {
    gatherInto(this, this.into, ch, slot, value);
    return;
  }
  if (ch.op === 'last' && !this.gate(ch)) return;
  const w = this.arg[Arg.WEIGHT] as number;
  const values = ch.values;
  if (ch.scalar) {
    values[slot] = foldNumber(ch.op, values[slot] as number, value as number, w);
    return;
  }
  const base = slot * ch.axes;
  // Indexed as `vec`'s fold indexes it, so a typed array folds as an array does.
  const arr =
    Array.isArray(value) || ArrayBuffer.isView(value) ? (value as ArrayLike<number>) : null;
  for (let a = 0; a < ch.axes; a++) {
    const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
    values[base + a] = foldNumber(ch.op, values[base + a] as number, v, w);
  }
}

/**
 * Whether a rest-less channel's contribution passes the band, for the record `one` is folding: the
 * general path's `apply` decides it from the same band state on the same record, so a subject
 * moving between the paths carries it.
 */
export function gate<I, O>(this: Lanes<I, O>, ch: Laned): boolean {
  const w = this.arg[Arg.WEIGHT] as number;
  const lane = this.folding as Lane<I, O>;
  const rec = this.rec as Subject<unknown>;
  const i = lane.chans.indexOf(ch);
  const bands = rec.bands ?? new Uint8Array(lane.chans.length);
  rec.bands = bands;
  const band = bands[i];
  const on = this.host.passes(band === 0 ? undefined : band === 1, w);
  bands[i] = on ? 1 : 2;
  return on;
}
