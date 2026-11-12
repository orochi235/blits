import { passAt, phaseAt, phaseBefore } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { type Laid, lay } from './lay.js';
import { type ChannelLookup, cachedRunner, type Runner } from './runner.js';
import { widthOf } from './runners/keys.js';
import { numbersOf } from './runners/keys-pack.js';
import { gpuDescriptor } from './shader-patch.js';
import { elapsedOf } from './table.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';

/** Where each channel sits in a hosted voice's numbers for one subject: a flag, then its value. */
interface Slot {
  readonly name: string;
  /** The flag, 1 where the voice's `at` gave the channel for the subject; its value follows. */
  readonly at: number;
  readonly width: number;
}

/** Each of the mix's channels' place in a hosted subject's numbers, and how many those take. */
function slotsOf(codes: ChannelLookup): { slots: Slot[]; stride: number } {
  let at = 0;
  const slots = [...codes].map(([name, code]) => {
    const slot = { name, at, width: widthOf(code) };
    at += 1 + slot.width;
    return slot;
  });
  return { slots, stride: at };
}

/**
 * The runner every kernel carries for voices whose own runner it lacks: each subject's value for
 * every channel, worked out on the CPU, read from `persub`, and folded only for the channels the
 * voice writes, as its values flag them, and gave for that subject, as its flags there say.
 */
export function hostRunner(codes: ChannelLookup): Runner {
  const { slots, stride } = slotsOf(codes);
  return cachedRunner(`host:${slots.map((s) => `${s.name}/${s.width}`).join(',')}`, () => {
    const lines = slots.map(({ name, at, width }) => {
      const reads = Array.from({ length: width }, (_, a) => `persub[sub + ${at + 1 + a}u]`);
      return `out.${name} = ${width === 1 ? reads[0] : `array<f32, ${width}>(${reads.join(', ')})`};`;
    });
    return {
      helpers: '',
      wgsl: lines.join(' '),
      writes: slots.map((s) => s.name),
      fields: [],
      stride,
      flags: slots.map((s) => s.at),
    };
  });
}

/**
 * Whether a voice can be folded through `hostRunner`: a shader patch, whose JS `at` gives what its
 * WGSL would, at one time for every subject.
 */
export function hostable<I>(voice: Voice<I, unknown>, answers: Answers<I>): boolean {
  if (gpuDescriptor(voice.patch) === undefined) return false;
  return !varies(voice as Voice<unknown, unknown>) || answers.of(voice).delays === null;
}

/** The setting `at` is handed here: its own, so `keep` and `send` reach nothing on the CPU. */
interface HostSetting {
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

/**
 * The CPU's values for each voice folded through `hostRunner` this frame, every registered subject's
 * laid end to end in `persub` after the reads.
 */
export class Hosted {
  /** f32s the hosted voices take in `persub`. */
  length = 0;
  private placed: Laid<Float32Array>[] = [];
  private readonly masks = new WeakMap<object, Float32Array>();
  /** Set where an `at` called `keep` or `send`, which a probe's would have reached. */
  private refused = false;
  private readonly setting: HostSetting = {
    timestamp: 0,
    dt: 0,
    elapsed: 0,
    pass: 0,
    weight: 0,
    state: undefined,
    host: undefined,
    keep: <K>(_owner: object, init: () => K): K => {
      this.refused = true;
      return init();
    },
    send: () => {
      this.refused = true;
    },
  };

  /** A hosted voice's values: 1 for each of the mix's channels it writes, 0 for the rest. */
  maskOf<I>(voice: Voice<I, unknown>, codes: ChannelLookup): Float32Array {
    let m = this.masks.get(voice);
    if (m === undefined) {
      const writes = voice.patch.writes as readonly string[];
      m = Float32Array.from([...codes.keys()], (n) => (writes.includes(n) ? 1 : 0));
      this.masks.set(voice, m);
    }
    return m;
  }

  /**
   * Works out each hosted voice's values for every subject in `list` and lays them from `from`; each
   * voice's offset, undefined for one not hosted. Null where an `at` gave a value the GPU cannot
   * read, or kept state or sent.
   */
  place<I>(
    mix: Mixer<I, unknown>,
    voices: readonly (Voice<I, unknown> | undefined)[],
    list: readonly I[],
    codes: ChannelLookup,
    from: number,
  ): (number | undefined)[] | null {
    const layout = slotsOf(codes);
    const rows = voices.map((v) =>
      v === undefined ? undefined : this.values(mix, v, list, layout),
    );
    if (rows.includes(null)) return null;
    const { placed, offsets, end } = lay(
      rows as (Float32Array | undefined)[],
      from,
      (r) => r.length,
    );
    this.placed = placed;
    this.length = end - from;
    return offsets;
  }

  private values<I>(
    mix: Mixer<I, unknown>,
    voice: Voice<I, unknown>,
    list: readonly I[],
    layout: { slots: Slot[]; stride: number },
  ): Float32Array | null {
    const stride = layout.stride;
    const out = new Float32Array(list.length * stride);
    const now = mix.now;
    const elapsed = elapsedOf(voice, now);
    if (Number.isNaN(elapsed)) return out;
    const { duration, passes } = voice;
    const phase = elapsed < 0 ? phaseBefore(elapsed, duration) : phaseAt(elapsed, duration, passes);
    const s = this.setting;
    s.timestamp = now;
    s.elapsed = elapsed;
    s.pass = passAt(elapsed, duration, passes);
    s.host = voice.setting.host;
    this.refused = false;
    const writes = voice.patch.writes as readonly string[];
    const slots = layout.slots.filter((slot) => writes.includes(slot.name));
    for (let i = 0; i < list.length; i++) {
      const delta = voice.patch.at(phase, list[i] as I, s as never) as Record<string, unknown>;
      for (const slot of slots) {
        const given = delta[slot.name];
        if (given === undefined) continue;
        const v = numbersOf(given, slot.width);
        if (v === undefined) return null;
        out[i * stride + slot.at] = 1;
        out.set(v, i * stride + slot.at + 1);
      }
    }
    return this.refused ? null : out;
  }

  /** Writes every hosted voice's values to `buffer`. */
  upload(device: GpuDevice, buffer: GpuBuffer): void {
    for (const { item, offset } of this.placed)
      if (item.length > 0) device.queue.writeBuffer(buffer, offset * 4, item);
  }
}
