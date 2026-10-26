import { foldNumber, lerpNumber } from './channels.js';
import { Arg, type Lane, type Laned, type Locus, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Subject } from './subject.js';
import { shortWay, turnFrom, turnInto, turnToward } from './turns.js';

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
  g.inline = inlined(g);
  if (g.inline) return;
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
  const takens = g.taken;
  for (let k = 0; k < takens.length; k++) {
    const taken = takens[k];
    if (taken !== undefined) taken[slot] = 0;
  }
}

/**
 * `gatherInto` for a plain scalar channel and the number at `Arg.VALUE`, which as an argument
 * would be boxed, 16 bytes a channel a member a subject (`locus`, bench/allocs.mjs, 2026-10-25).
 */
function gatherScalar<I, O>(lanes: Lanes<I, O>, g: Locus<I, O>, ch: Laned, slot: number): void {
  const arg = lanes.arg;
  const value = arg[Arg.VALUE] as number;
  const values = g.values[ch.index];
  const takenAt = g.taken[ch.index];
  if (values === undefined || takenAt === undefined) {
    gatherInto(lanes, g, ch, slot, value);
    return;
  }
  const w = arg[Arg.WEIGHT] as number;
  meetLocus(lanes, g, slot);
  const taken = takenAt[slot] as number;
  const total = taken + w;
  values[slot] = taken === 0 ? value : lerpNumber(values[slot] as number, value, w / total);
  takenAt[slot] = total;
}

/**
 * A member's value for one channel of a subject, lerped into its locus: the step of the general
 * path's `foldLocus`.
 */
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
  if (!ch.plain || !ch.straight) turnToward(ch, values, slot * ch.axes, value, taken, u);
  else if (ch.scalar) {
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
    if ((g.sum[slot] as number) > 0) foldAt(lanes, g, slot);
  }
}

/** Folds what a locus gathered for the subject at `slot` into its laned values. */
function foldAt<I, O>(lanes: Lanes<I, O>, g: Locus<I, O>, slot: number): void {
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
    if (!ch.plain) {
      turnFrom(ch, into, base, values, base, w);
      continue;
    }
    for (let a = 0; a < ch.axes; a++)
      into[base + a] = foldNumber(ch.op, into[base + a] as number, values[base + a] as number, w);
  }
}

/**
 * Whether a fill can run a locus a subject at a time: every member playing, on its lane, keeping
 * no state, and over the same subjects in the same places, with no other voice between them.
 */
function inlined<I, O>(g: Locus<I, O>): boolean {
  if (!g.contiguous) return false;
  const members = g.members;
  const list = (members[0] as Lane<I, O>).list;
  for (const lane of members) {
    const voice = lane.voice;
    if (lane.idle || voice.keeping || voice.state === 'pending' || voice.state === 'done')
      return false;
    const own = lane.list;
    if (own === list) continue;
    if (own.length !== list.length) return false;
    for (let p = 0; p < list.length; p++) if (own[p] !== list[p]) return false;
  }
  return true;
}

/**
 * An inlined locus at its first member's turn: each subject's members gathered in voice order, as
 * `gatherLocus` gathers them, then folded at once, with no pass of its own and no array of sums.
 */
export function runLocus<I, O>(lanes: Lanes<I, O>, g: Locus<I, O>): void {
  const members = g.members;
  const arg = lanes.arg;
  for (const lane of members) {
    lanes.reset(lane);
    lane.elapsedNow = lane.voice.elapsedAt(lanes.now);
  }
  const list = (members[0] as Lane<I, O>).list;
  lanes.into = g;
  try {
    for (let p = 0; p < list.length; p++) {
      const slot = list[p] as number;
      let sum = 0;
      for (let i = 0; i < members.length; i++) {
        const lane = members[i] as Lane<I, O>;
        // Its patch kept state on an earlier subject: as `gatherLocus` leaves it after that call.
        if (lane.voice.keeping) continue;
        // Each lane's placing is numbered on its own; the last member placed left its number.
        arg[Arg.MARK] = lane.mark;
        if (lanes.one(lane, p, slot)) {
          meetLocus(lanes, g, slot);
          sum += lane.data[p * Row.STRIDE + Row.WEIGHT] as number;
        }
      }
      if (sum > 0) foldAt(lanes, g, slot);
    }
  } finally {
    lanes.into = null;
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
  const arg = this.arg;
  // A plain number is folded where it is read: passed to a `foldInto` V8 did not inline, it is
  // boxed, 16 bytes a channel a subject, and whether V8 inlines it turns on the order its compiles
  // ran (bench/allocs.mjs, 2026-10-20).
  let ch = chans[0] as Laned;
  if (n > 0) {
    const v = delta[ch.name];
    if (typeof v === 'number' && ch.scalar && ch.plain) {
      const into = this.into;
      if (into === null) {
        const values = ch.values;
        values[slot] = foldNumber(ch.op, values[slot] as number, v, arg[Arg.WEIGHT] as number);
      } else {
        arg[Arg.VALUE] = v;
        gatherScalar(this, into, ch, slot);
      }
    } else this.foldInto(ch, slot, v);
  }
  ch = chans[1] as Laned;
  if (n > 1) {
    const v = delta[ch.name];
    if (typeof v === 'number' && ch.scalar && ch.plain) {
      const into = this.into;
      if (into === null) {
        const values = ch.values;
        values[slot] = foldNumber(ch.op, values[slot] as number, v, arg[Arg.WEIGHT] as number);
      } else {
        arg[Arg.VALUE] = v;
        gatherScalar(this, into, ch, slot);
      }
    } else this.foldInto(ch, slot, v);
  }
  ch = chans[2] as Laned;
  if (n > 2) {
    const v = delta[ch.name];
    if (typeof v === 'number' && ch.scalar && ch.plain) {
      const into = this.into;
      if (into === null) {
        const values = ch.values;
        values[slot] = foldNumber(ch.op, values[slot] as number, v, arg[Arg.WEIGHT] as number);
      } else {
        arg[Arg.VALUE] = v;
        gatherScalar(this, into, ch, slot);
      }
    } else this.foldInto(ch, slot, v);
  }
  for (let i = 3; i < n; i++) {
    ch = chans[i] as Laned;
    const v = delta[ch.name];
    if (typeof v === 'number' && ch.scalar && ch.plain) {
      const into = this.into;
      if (into === null) {
        const values = ch.values;
        values[slot] = foldNumber(ch.op, values[slot] as number, v, arg[Arg.WEIGHT] as number);
      } else {
        arg[Arg.VALUE] = v;
        gatherScalar(this, into, ch, slot);
      }
    } else this.foldInto(ch, slot, v);
  }
}

/** Folds a motion sample's axes, kept apart from `foldInto` so neither reads two array kinds. */
export function foldRun<I, O>(this: Lanes<I, O>, ch: Laned, slot: number, xs: Float64Array): void {
  if (!ch.plain) {
    this.unplain(ch, slot, ch.scalar ? xs[0] : xs);
    return;
  }
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
  if (!ch.plain && !this.unplain(ch, slot, value)) return;
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

/**
 * `foldInto` for a channel that is not plain, at `Arg.WEIGHT`. A rest-less one asks its band, and
 * true is a pass, which `foldInto` then folds; a rotation is folded here, so false.
 */
export function unplain<I, O>(this: Lanes<I, O>, ch: Laned, slot: number, value: unknown): boolean {
  if (ch.op === 'last') return this.gate(ch);
  const w = this.arg[Arg.WEIGHT] as number;
  const values = ch.values;
  // An angle here and not through `turnInto`, where its weight would cross a call as a boxed double.
  if (ch.turn > 0) values[slot] = (values[slot] as number) + shortWay(value as number, ch.turn) * w;
  else turnInto(ch, values, slot * ch.axes, value, w);
  return false;
}
