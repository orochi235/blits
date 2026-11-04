import { passAt } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Signal } from '../types.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { elapsedOf } from './table.js';
import { reaches } from './unread.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';
import { KEEPS, perSubject, SENDS } from './weight.js';

/** The largest finite f32, which an infinite read is stored as. */
const MAX_F32 = 3.4028234663852886e38;

/** One voice's reads for one `read`, and the mix times dt counts from. */
interface Held {
  values: Float32Array;
  /** The `mix.now` it was last read at, and the one before that; NaN before its first read. */
  at: number;
  before: number;
  /** The voice's `seeks` at its last read: a seek forgets the times dt counts from. */
  seeks: number;
}

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
  private by = new Map<Voice<I, unknown>, Held>();
  private placed: { values: Float32Array; offset: number }[] = [];
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

  /** Lets go of every voice's reads; called from `GpuSide.subjects` and `close`. */
  clear(): void {
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
    const now = mix.now;
    const n = list.length;
    const by = new Map<Voice<I, unknown>, Held>();
    const s = this.setting;
    this.refusedNow = false;
    for (const voice of voices) {
      if (!perSubject(voice)) continue;
      let held = this.by.get(voice);
      if (held === undefined || held.values.length !== n || held.seeks !== voice.seeks)
        held = {
          values: new Float32Array(n),
          at: Number.NaN,
          before: Number.NaN,
          seeks: voice.seeks,
        };
      else if (held.at !== now) {
        held.before = held.at;
        held.at = now;
      }
      by.set(voice, held);
      const signal = voice.spec.weight as Signal<I>;
      const answer = varies(voice as Voice<unknown, unknown>) ? answers.of(voice) : null;
      const delays = answer?.delays ?? null;
      const reach = answer?.reach ?? null;
      const values = held.values;
      s.timestamp = now;
      s.host = voice.setting.host;
      this.reading = signal;
      try {
        for (let i = 0; i < n; i++) {
          const delay = delays === null ? 0 : (delays[i] as number);
          const elapsed = reaches(reach, i) ? elapsedOf(voice, now, delay) : Number.NaN;
          if (Number.isNaN(elapsed)) {
            values[i] = 0;
            continue;
          }
          let previous = held.before;
          if (Number.isNaN(previous)) {
            const since = mix.sinceOf(voice, delay);
            previous = since < now ? since : now;
          }
          s.dt = mix.capped(now - previous);
          s.elapsed = elapsed;
          s.pass = passAt(elapsed, voice.duration, voice.passes);
          s.weight = 0;
          values[i] = stored(signal(list[i] as I, s as never));
        }
      } finally {
        this.reading = null;
      }
      if (Number.isNaN(held.at)) held.at = now;
    }
    this.by = by;
    return !this.refusedNow;
  }

  /** `voice`'s reads from the last `read`, or null where it has none. */
  of(voice: Voice<I, unknown>): Float32Array | null {
    return this.by.get(voice)?.values ?? null;
  }

  /** Where each voice's reads start in `persub`, in voice order, laid from `from`. */
  place(voices: readonly Voice<I, unknown>[], from: number): (number | undefined)[] {
    const placed: { values: Float32Array; offset: number }[] = [];
    let at = from;
    const offsets = voices.map((voice) => {
      const values = this.by.get(voice)?.values;
      if (values === undefined) return undefined;
      placed.push({ values, offset: at });
      const offset = at;
      at += values.length;
      return offset;
    });
    this.placed = placed;
    this.length = at - from;
    return offsets;
  }

  /** Writes every placed voice's reads to `buffer`. */
  upload(device: GpuDevice, buffer: GpuBuffer): void {
    for (const { values, offset } of this.placed)
      if (values.length > 0) device.queue.writeBuffer(buffer, offset * 4, values);
  }
}
