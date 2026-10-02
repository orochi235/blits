import { foldNumber, type Numeric, numericOf } from './channels.js';
import { clampWeight, passesOf, place, placed } from './clock.js';
import type { Subject, Voice } from './mixer.js';
import { absent, Numbers } from './numbers.js';
import { readKeys } from './patch.js';
import type { Channel } from './types.js';

/** What qualifying needs of one voice: whether its patch and spec can run on a lane, and its channels. */
export interface Candidate {
  readonly id: number;
  readonly fits: boolean;
  readonly slots: readonly number[];
}

/**
 * Which channels run as lanes and which voices run on them: the fixed point where every voice
 * writing a laned channel fits and writes only laned channels. Only channels some laned voice
 * writes are laned.
 */
export function qualify(
  numeric: readonly boolean[],
  voices: readonly Candidate[],
): { channels: boolean[]; voices: Set<number> } {
  const open = numeric.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of voices) {
      if (v.fits && v.slots.every((s) => open[s])) continue;
      for (const s of v.slots)
        if (open[s]) {
          open[s] = false;
          changed = true;
        }
    }
  }
  const laned = new Set<number>();
  const channels = numeric.map(() => false);
  for (const v of voices) {
    if (!v.fits || !v.slots.every((s) => open[s])) continue;
    laned.add(v.id);
    for (const s of v.slots) channels[s] = true;
  }
  return { channels, voices: laned };
}

/** What a lane fill asks of the mix it belongs to. */
export interface LaneHost<I, O> {
  readonly now: number;
  readonly version: number;
  readonly voices: readonly Voice<I, O>[];
  readonly channels: readonly Channel<unknown>[];
  readonly names: readonly string[];
  /** Whether a voice's patch and spec can run on a lane, its channels aside. */
  fits(voice: Voice<I, O>): boolean;
  /** The voice's record for the subject, made on first sight exactly as a probe makes it. */
  meet(voice: Voice<I, O>, subject: I): Subject<unknown>;
  /** The voice's own fade for a subject whose delay ran out at `since`. */
  envelope(voice: Voice<I, O>, since: number): number;
  /** Fills the voice's setting and the send target for a call to its patch. */
  ready(
    voice: Voice<I, O>,
    subject: I,
    held: Subject<unknown>,
    elapsed: number,
    pass: number,
    weight: number,
  ): void;
  /** Sets `reading.horizon` for the voice and a subject delayed `delay` voice ms. */
  horizon(voice: Voice<I, O>, delay: number): void;
  /** After a patch call, keeps history of a record that grew kept state. */
  after(voice: Voice<I, O>, held: Subject<unknown>): void;
  /** The subject's number, -1 for one not yet numbered. */
  slotOf(subject: I): number;
}

/** One laned channel: its arithmetic, and every numbered subject's folded value, `axes` per subject. */
interface Laned {
  name: string;
  op: Numeric['op'];
  rest: number;
  axes: number;
  values: Float64Array;
}

/**
 * What one laned voice keeps per subject, by position: the subject's number itself for a voice that
 * reaches every subject, its place in `list` for one that names its subjects.
 */
class Lane<I, O> {
  readonly dense: boolean;
  /** For a voice naming its subjects: the numbers of the ones it names that have one. */
  readonly list: number[] = [];
  private readonly at = new Map<number, number>();
  /** 0 not yet met, 1 reaches, 2 does not. */
  reach = new Uint8Array(0);
  delay = new Float64Array(0);
  since = new Float64Array(0);
  weight = new Float64Array(0);
  /** A motion patch's own number for the subject, -1 until asked. */
  mslot = new Int32Array(0);
  records: (Subject<unknown> | undefined)[] = [];
  /** What a keys read writes into, reused across subjects. */
  readonly delta: Record<string, unknown> = {};

  constructor(readonly voice: Voice<I, O>) {
    this.dense = voice.named === null;
  }

  positionOf(slot: number): number {
    return this.dense ? slot : (this.at.get(slot) ?? -1);
  }

  grow(size: number): void {
    const cap = this.reach.length;
    if (size <= cap) return;
    const next = Math.max(size, cap * 2, 16);
    const reach = new Uint8Array(next);
    reach.set(this.reach);
    this.reach = reach;
    const more = (a: Float64Array) => {
      const b = new Float64Array(next);
      b.set(a);
      return b;
    };
    this.delay = more(this.delay);
    this.since = more(this.since);
    this.weight = more(this.weight);
    const mslot = new Int32Array(next).fill(-1);
    mslot.set(this.mslot);
    this.mslot = mslot;
  }

  /** For a voice naming its subjects: one of them has been numbered. */
  add(slot: number): void {
    if (this.at.has(slot)) return;
    const p = this.list.length;
    this.list.push(slot);
    this.at.set(slot, p);
    this.grow(p + 1);
    this.clear(p);
  }

  /** Forgets a position, so a number handed to a new subject starts unmet. */
  clear(p: number): void {
    this.reach[p] = 0;
    this.weight[p] = 0;
    this.mslot[p] = -1;
    this.records[p] = undefined;
  }

  /** For a voice naming its subjects: one of them lost its number. */
  remove(slot: number): void {
    const p = this.at.get(slot);
    if (p === undefined) return;
    const last = this.list.length - 1;
    if (p !== last) {
      const moved = this.list[last] as number;
      this.list[p] = moved;
      this.at.set(moved, p);
      this.reach[p] = this.reach[last] as number;
      this.delay[p] = this.delay[last] as number;
      this.since[p] = this.since[last] as number;
      this.weight[p] = this.weight[last] as number;
      this.mslot[p] = this.mslot[last] as number;
      this.records[p] = this.records[last];
    }
    this.list.pop();
    this.at.delete(slot);
    this.clear(last);
  }
}

/**
 * The lanes of one mix: subject numbers, which channels and voices run on lanes, and the values a
 * frame's fill leaves for probes to copy.
 */
export class Lanes<I, O> {
  readonly numbers: Numbers<I>;
  private lanes: Lane<I, O>[] = [];
  private readonly byId = new Map<number, Lane<I, O>>();
  private laned: Laned[] = [];
  /** By kit slot, the laned channel there. */
  private bySlot: (Laned | undefined)[] = [];
  private cap = 0;
  /** Per subject number, which fill last wrote it. */
  private filled = new Uint32Array(0);
  private fills = 0;
  private filledAt = Number.NaN;
  private filledVersion = Number.NaN;
  private qualifiedVersion = Number.NaN;

  constructor(private readonly host: LaneHost<I, O>) {
    this.numbers = new Numbers<I>((slot) => this.forget(slot));
  }

  /** A change that may move a voice on or off its lane: qualify again, then fill again. */
  invalidate(): void {
    this.qualifiedVersion = Number.NaN;
    this.filledVersion = Number.NaN;
  }

  /** A change to a laned voice's weight or clock between probes: fill again. */
  refill(): void {
    this.filledVersion = Number.NaN;
  }

  number(subject: I, naming: readonly Voice<I, O>[] | undefined): number {
    const slot = this.numbers.take(subject);
    this.grow(slot + 1);
    this.filled[slot] = 0;
    if (naming !== undefined) for (const v of naming) this.byId.get(v.id)?.add(slot);
    return slot;
  }

  release(slot: number): void {
    this.numbers.release(slot);
  }

  /** A laned voice's weight for a subject this frame; undefined for a voice not on a lane. */
  weightOf(id: number, slot: number): number | undefined {
    const lane = this.byId.get(id);
    if (lane === undefined) return undefined;
    const p = slot < 0 ? -1 : lane.positionOf(slot);
    return p < 0 ? 0 : (lane.weight[p] as number);
  }

  /** Makes this frame's values for `slot` current. False when no channel runs as a lane. */
  prepare(slot: number): boolean {
    const host = this.host;
    if (this.qualifiedVersion !== host.version) this.requalify();
    if (this.laned.length === 0) return false;
    if (this.filledAt !== host.now || this.filledVersion !== host.version) this.fillAll();
    else if (slot >= 0 && this.filled[slot] !== this.fills) this.fillOne(slot);
    return true;
  }

  /** Writes a subject's laned values into a pose whose laned channels hold fresh copies of rest. */
  copy(slot: number, pose: Record<string, unknown>): void {
    if (slot < 0) return;
    for (const ch of this.laned) {
      if (ch.axes === 1) {
        pose[ch.name] = ch.values[slot] as number;
        continue;
      }
      const arr = pose[ch.name] as number[];
      const base = slot * ch.axes;
      for (let a = 0; a < ch.axes; a++) arr[a] = ch.values[base + a] as number;
    }
  }

  private forget(slot: number): void {
    for (const lane of this.lanes) {
      if (lane.dense) {
        if (slot < lane.reach.length) lane.clear(slot);
      } else lane.remove(slot);
    }
    if (slot < this.filled.length) this.filled[slot] = 0;
  }

  private grow(size: number): void {
    if (size <= this.cap) return;
    const cap = Math.max(size, this.cap * 2, 64);
    const filled = new Uint32Array(cap);
    filled.set(this.filled);
    this.filled = filled;
    for (const ch of this.laned) {
      const values = new Float64Array(cap * ch.axes);
      values.set(ch.values);
      ch.values = values;
    }
    for (const lane of this.lanes) if (lane.dense) lane.grow(cap);
    this.cap = cap;
  }

  private requalify(): void {
    const host = this.host;
    this.qualifiedVersion = host.version;
    this.filledVersion = Number.NaN;
    const present = host.voices.filter((v) => v.state !== 'done');
    const numeric = host.channels.map((c) => numericOf(c) !== undefined);
    const { channels, voices } = qualify(
      numeric,
      // A voice writing nothing has no lane to fill, so it stays where its calls are made.
      present.map((v) => ({ id: v.id, fits: v.slots.length > 0 && host.fits(v), slots: v.slots })),
    );
    for (const lane of this.lanes) if (!voices.has(lane.voice.id)) this.leave(lane);
    const kept: Lane<I, O>[] = [];
    for (const v of present) {
      if (!voices.has(v.id)) continue;
      kept.push(this.byId.get(v.id) ?? this.join(v));
    }
    this.lanes = kept;
    this.byId.clear();
    for (const lane of kept) this.byId.set(lane.voice.id, lane);
    this.laned = [];
    this.bySlot = host.channels.map(() => undefined);
    channels.forEach((on, slot) => {
      if (!on) return;
      const n = numericOf(host.channels[slot] as Channel<unknown>) as Numeric;
      const ch: Laned = {
        name: host.names[slot] as string,
        op: n.op,
        rest: n.rest,
        axes: n.axes,
        values: new Float64Array(this.cap * n.axes),
      };
      this.laned.push(ch);
      this.bySlot[slot] = ch;
    });
  }

  private join(voice: Voice<I, O>): Lane<I, O> {
    const lane = new Lane<I, O>(voice);
    voice.laned = true;
    voice.holder = null;
    if (lane.dense) lane.grow(this.cap);
    else
      for (const subject of voice.named as ReadonlySet<I>) {
        const slot = this.host.slotOf(subject);
        if (slot >= 0) lane.add(slot);
      }
    return lane;
  }

  /** Hands a voice back to the general path, with the weights `weightOf` reports kept on its records. */
  private leave(lane: Lane<I, O>): void {
    const n = lane.dense ? lane.records.length : lane.list.length;
    for (let p = 0; p < n; p++) {
      const rec = lane.records[p];
      if (rec !== undefined) rec.weight = lane.weight[p] as number;
    }
    lane.voice.laned = false;
    lane.voice.holder = null;
  }

  private fillAll(): void {
    const host = this.host;
    this.fills++;
    this.filledAt = host.now;
    this.filledVersion = host.version;
    const size = this.numbers.size;
    for (const ch of this.laned) ch.values.fill(ch.rest, 0, size * ch.axes);
    for (const lane of this.lanes) this.run(lane, -1);
    this.filled.fill(this.fills, 0, size);
  }

  private fillOne(slot: number): void {
    for (const ch of this.laned) ch.values.fill(ch.rest, slot * ch.axes, (slot + 1) * ch.axes);
    for (const lane of this.lanes) this.run(lane, slot);
    this.filled[slot] = this.fills;
  }

  /** One voice's contribution: to every subject it reaches, or to `only` where that is ≥ 0. */
  private run(lane: Lane<I, O>, only: number): void {
    const voice = lane.voice;
    if (voice.state !== 'live' && voice.state !== 'fading') return;
    const elapsed = voice.elapsedAt(this.host.now);
    const period = voice.patch.period;
    const passes = passesOf(voice.spec.loop);
    if (only >= 0) {
      const p = lane.positionOf(only);
      if (p >= 0) this.one(lane, p, only, elapsed, period, passes);
      return;
    }
    if (lane.dense) {
      const size = this.numbers.size;
      for (let s = 0; s < size; s++)
        if (this.numbers.alive(s)) this.one(lane, s, s, elapsed, period, passes);
      return;
    }
    for (let p = 0; p < lane.list.length; p++)
      this.one(lane, p, lane.list[p] as number, elapsed, period, passes);
  }

  private one(
    lane: Lane<I, O>,
    p: number,
    slot: number,
    elapsedNow: number,
    period: number,
    passes: number,
  ): void {
    const host = this.host;
    const voice = lane.voice;
    let r = lane.reach[p] as number;
    if (r === 0) {
      const subject = this.numbers.subject(slot);
      if (subject === absent) return;
      const held = host.meet(voice, subject);
      lane.records[p] = held;
      lane.delay[p] = held.delay;
      lane.since[p] = held.since;
      r = held.reaches ? 1 : 2;
      lane.reach[p] = r;
    }
    if (r === 2) return;
    const delay = lane.delay[p] as number;
    const elapsed = elapsedNow - delay;
    if (elapsed < 0) {
      lane.weight[p] = 0;
      return;
    }
    place(elapsed, period, passes);
    const w = clampWeight(voice.weight * host.envelope(voice, lane.since[p] as number));
    lane.weight[p] = w;
    if (voice.built !== null) {
      readKeys(
        voice.built,
        placed.phase,
        lane.delta,
        undefined,
        voice.lerps as never,
        undefined,
        voice.intos,
        voice.scratch,
      );
      if (w > 0) this.fold(voice, slot, lane.delta, w);
      return;
    }
    const subject = this.numbers.subject(slot);
    if (subject === absent) return;
    const held = lane.records[p] as Subject<unknown>;
    host.ready(voice, subject, held, elapsed, placed.pass, w);
    host.horizon(voice, delay);
    const delta = voice.patch.at(placed.phase, subject, voice.setting as never) as Record<
      string,
      unknown
    >;
    host.after(voice, held);
    if (w > 0) this.fold(voice, slot, delta, w);
  }

  private fold(voice: Voice<I, O>, slot: number, delta: Record<string, unknown>, w: number): void {
    const slots = voice.slots;
    for (let i = 0; i < slots.length; i++) {
      const ch = this.bySlot[slots[i] as number] as Laned;
      const value = delta[ch.name];
      if (value === undefined) continue;
      const values = ch.values;
      if (ch.axes === 1) {
        values[slot] = foldNumber(ch.op, values[slot] as number, value as number, w);
        continue;
      }
      const base = slot * ch.axes;
      const arr = Array.isArray(value) ? (value as number[]) : null;
      for (let a = 0; a < ch.axes; a++) {
        const v = arr === null ? ch.rest : (arr[a] ?? ch.rest);
        values[base + a] = foldNumber(ch.op, values[base + a] as number, v, w);
      }
    }
  }
}
