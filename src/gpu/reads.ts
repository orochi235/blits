import { passAt } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Signal } from '../types.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { type Laid, lay } from './lay.js';
import { elapsedOf } from './table.js';
import { reaches } from './unread.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';
import { KEEPS, perSubject, SENDS } from './weight.js';

/** The largest finite f32, which an infinite read is stored as. */
const MAX_F32 = 3.4028234663852886e38;

/**
 * One voice's reads from the last `read` it was in, and what a CPU record of each subject keeps for
 * `dt`: where it counts from, NaN until the voice meets the subject, and the mix time the subject
 * was last read at, NaN before its first read and after a seek back. While every subject's are the
 * same, as for a voice with no delays, they are `stepped` and `probed`, and `steps` and `probes`
 * are null; otherwise they are per subject, by registration order.
 */
interface Held {
  values: Float32Array;
  stepped: number;
  probed: number;
  steps: Float64Array | null;
  probes: Float64Array | null;
}

const heldOf = (n: number): Held => ({
  values: new Float32Array(n),
  stepped: Number.NaN,
  probed: Number.NaN,
  steps: null,
  probes: null,
});

/** Where a read at `now` counts `dt` from, as `prime` has it: a read in an earlier frame, if any. */
const fromOf = (stepped: number, probed: number, now: number): number =>
  probed < now ? probed : stepped;

/**
 * Where a subject first read at `now` counts from, as `meet` has it: its start, or now for one shown
 * frozen before it.
 */
const metAt = (since: number, now: number): number => (since < now ? since : now);

/** The setting a read passes its signal: its own, so `keep` and `send` reach nothing on the CPU. */
interface ReadSetting {
  timestamp: number;
  dt: number;
  elapsed: number;
  pass: number;
  weight: number;
  state: undefined;
  host: unknown;
  keep<K>(owner: object, init: () => K): K;
  send(event: unknown): void;
}

const stored = (x: number): number =>
  Number.isNaN(x) ? 0 : x === Infinity ? MAX_F32 : x === -Infinity ? -MAX_F32 : Math.fround(x);

/**
 * Each folded voice's weight signal read per subject on the CPU, by registration order, laid end
 * to end in `persub` after the mirrors and timing blocks. A signal that keeps state or sends is
 * refused, since its read here would not reach the records and events a probe's would.
 */
export class Reads<I> {
  /** Signals that called `keep` or `send` in a read, with why the voice stays on the CPU. */
  readonly refused = new WeakMap<object, string>();
  /** f32s the reads take in `persub`. */
  length = 0;
  /** Every voice read while it is still in the mix, read in the last `read` or not. */
  private held = new Map<Voice<I, unknown>, Held>();
  /** The last `read`'s reads, by voice. */
  private by = new Map<Voice<I, unknown>, Float32Array>();
  private placed: Laid<Float32Array>[] = [];
  /** The signal being read, which `keep` and `send` refuse. */
  private reading: object | null = null;
  private refusedNow = false;
  private readonly setting: ReadSetting = {
    timestamp: 0,
    dt: 0,
    elapsed: 0,
    pass: 0,
    weight: 0,
    state: undefined,
    host: undefined,
    keep: <K>(_owner: object, init: () => K): K => {
      this.refuse(KEEPS);
      return init();
    },
    send: () => this.refuse(SENDS),
  };

  private refuse(why: string): void {
    const s = this.reading;
    if (s === null) return;
    if (!this.refused.has(s)) this.refused.set(s, why);
    this.refusedNow = true;
  }

  /**
   * Has each seek back on `mix` move what `dt` counts from as it moves a CPU record's, by the
   * delays in `answers`.
   */
  follow(mix: Mixer<I, unknown>, answers: () => Answers<I>): () => void {
    return mix.onSeek((s) => {
      if (s.back) this.back(mix, s.at, answers());
    });
  }

  /**
   * As `restore` puts back a stateless record for mix time `t`: one stepped past `t` counts from
   * `t`, or, with its `since` still ahead, from that once first read.
   */
  private back(mix: Mixer<I, unknown>, t: number, answers: Answers<I>): void {
    for (const [voice, held] of this.held) {
      // A voice parked before its cue meets its subjects afresh; one done by `t` is left as it is.
      if (voice.parked) this.held.delete(voice);
      if (voice.parked || !mix.cued.includes(voice)) continue;
      const waits = !voice.freezesBefore;
      if (held.stepped > t) held.stepped = waits && mix.sinceOf(voice, 0) > t ? Number.NaN : t;
      held.probed = Number.NaN;
      const { steps, probes } = held;
      if (steps === null || probes === null) continue;
      const delays = varies(voice as Voice<unknown, unknown>) ? answers.of(voice).delays : null;
      for (let i = 0; i < steps.length; i++) {
        if ((steps[i] as number) > t) {
          const since = mix.sinceOf(voice, delays === null ? 0 : (delays[i] as number));
          steps[i] = waits && since > t ? Number.NaN : t;
        }
        probes[i] = Number.NaN;
      }
    }
  }

  /** Moves each voice's reads from the subjects in `was` to the same subjects in `list`. */
  relist(was: readonly I[], list: readonly I[]): void {
    this.by.clear();
    this.placed = [];
    this.length = 0;
    if (this.held.size === 0) return;
    const at = new Map<I, number>();
    for (let i = 0; i < was.length; i++) at.set(was[i] as I, i);
    for (const [voice, old] of this.held) {
      const held = heldOf(list.length);
      const steps = new Float64Array(list.length).fill(Number.NaN);
      const probes = new Float64Array(list.length).fill(Number.NaN);
      for (let j = 0; j < list.length; j++) {
        const i = at.get(list[j] as I);
        if (i === undefined) continue;
        steps[j] = old.steps === null ? old.stepped : (old.steps[i] as number);
        probes[j] = old.probes === null ? old.probed : (old.probes[i] as number);
      }
      held.steps = steps;
      held.probes = probes;
      this.held.set(voice, held);
    }
  }

  /** Lets go of every voice's reads; called from `GpuSide.close`. */
  clear(): void {
    this.held.clear();
    this.by.clear();
    this.placed = [];
    this.length = 0;
  }

  /**
   * Reads each per-subject voice's signal for every registered subject it reaches and that shows
   * now, 0 elsewhere. False where a signal was refused, so the voices are sorted again.
   */
  read(
    mix: Mixer<I, unknown>,
    voices: readonly Voice<I, unknown>[],
    list: readonly I[],
    answers: Answers<I>,
  ): boolean {
    const n = list.length;
    const by = new Map<Voice<I, unknown>, Float32Array>();
    this.refusedNow = false;
    for (const voice of voices) {
      if (!perSubject(voice)) continue;
      let held = this.held.get(voice);
      if (held === undefined || held.values.length !== n) {
        held = heldOf(n);
        this.held.set(voice, held);
      }
      by.set(voice, held.values);
      const answer = varies(voice as Voice<unknown, unknown>) ? answers.of(voice) : null;
      const delays = answer?.delays ?? null;
      const reach = answer?.reach ?? null;
      this.setting.host = voice.setting.host;
      this.reading = voice.spec.weight as Signal<I>;
      try {
        if (delays === null && held.steps === null) this.readAlike(mix, voice, held, list, reach);
        else this.readApart(mix, voice, held, list, reach, delays);
      } finally {
        this.reading = null;
      }
    }
    this.by = by;
    if (this.held.size > by.size)
      for (const voice of this.held.keys())
        if (!by.has(voice) && !mix.cued.includes(voice) && !mix.gone.includes(voice))
          this.held.delete(voice);
    return !this.refusedNow;
  }

  /** A voice with no delays, every subject's `dt` the same as its records' are. */
  private readAlike(
    mix: Mixer<I, unknown>,
    voice: Voice<I, unknown>,
    held: Held,
    list: readonly I[],
    reach: Uint32Array | null,
  ): void {
    const now = mix.now;
    const values = held.values;
    const elapsed = elapsedOf(voice, now);
    if (Number.isNaN(elapsed)) {
      values.fill(0);
      return;
    }
    if (Number.isNaN(held.stepped)) held.stepped = metAt(mix.sinceOf(voice, 0), now);
    held.stepped = fromOf(held.stepped, held.probed, now);
    held.probed = now;
    const s = this.setting;
    s.timestamp = now;
    s.dt = mix.capped(now - held.stepped);
    s.elapsed = elapsed;
    s.pass = passAt(elapsed, voice.duration, voice.passes);
    const signal = voice.spec.weight as Signal<I>;
    for (let i = 0; i < list.length; i++) {
      if (!reaches(reach, i)) {
        values[i] = 0;
        continue;
      }
      s.weight = 0;
      values[i] = stored(signal(list[i] as I, s as never));
    }
  }

  /**
   * A voice whose subjects' `dt`s may differ, each kept apart, until a read leaves every subject
   * it reaches with the same again, as a voice with no delays does once each has been read.
   */
  private readApart(
    mix: Mixer<I, unknown>,
    voice: Voice<I, unknown>,
    held: Held,
    list: readonly I[],
    reach: Uint32Array | null,
    delays: Float64Array | null,
  ): void {
    const now = mix.now;
    const n = list.length;
    const steps = held.steps ?? new Float64Array(n).fill(held.stepped);
    const probes = held.probes ?? new Float64Array(n).fill(held.probed);
    held.steps = steps;
    held.probes = probes;
    const { values } = held;
    const s = this.setting;
    s.timestamp = now;
    const signal = voice.spec.weight as Signal<I>;
    let alike = delays === null;
    let common = Number.NaN;
    for (let i = 0; i < n; i++) {
      if (!reaches(reach, i)) {
        values[i] = 0;
        continue;
      }
      const delay = delays === null ? 0 : (delays[i] as number);
      const elapsed = elapsedOf(voice, now, delay);
      if (Number.isNaN(elapsed)) {
        values[i] = 0;
        alike = false;
        continue;
      }
      let stepped = steps[i] as number;
      if (Number.isNaN(stepped)) stepped = metAt(mix.sinceOf(voice, delay), now);
      stepped = fromOf(stepped, probes[i] as number, now);
      steps[i] = stepped;
      probes[i] = now;
      if (alike && stepped !== common) {
        if (Number.isNaN(common)) common = stepped;
        else alike = false;
      }
      s.dt = mix.capped(now - stepped);
      s.elapsed = elapsed;
      s.pass = passAt(elapsed, voice.duration, voice.passes);
      s.weight = 0;
      values[i] = stored(signal(list[i] as I, s as never));
    }
    if (alike && !Number.isNaN(common)) {
      held.stepped = common;
      held.probed = now;
      held.steps = null;
      held.probes = null;
    }
  }

  /** `voice`'s reads from the last `read`, or null where it has none. */
  of(voice: Voice<I, unknown>): Float32Array | null {
    return this.by.get(voice) ?? null;
  }

  /** Where each voice's reads start in `persub`, in voice order, laid from `from`. */
  place(voices: readonly Voice<I, unknown>[], from: number): (number | undefined)[] {
    const all = voices.map((voice) => this.by.get(voice));
    const { placed, offsets, end } = lay(all, from, (values) => values.length);
    this.placed = placed;
    this.length = end - from;
    return offsets;
  }

  /** Writes every placed voice's reads to `buffer`. */
  upload(device: GpuDevice, buffer: GpuBuffer): void {
    for (const { item: values, offset } of this.placed)
      if (values.length > 0) device.queue.writeBuffer(buffer, offset * 4, values);
  }
}
