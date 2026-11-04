import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import type { Answer, Answers } from './answers.js';
import type { GpuBuffer, GpuDevice } from './webgpu.js';
import { NONE } from './wgsl/timing.js';

/** Where a voice's timing block sits in `persub`, in f32s; NONE for a part it has none of. */
export interface TimingSlot {
  readonly delays: number;
  readonly mask: number;
  readonly shown: number;
  /** The mix time `shown` counts from (f64; never sent to the GPU itself). */
  readonly anchor: number;
  /** The latest subject's fade-in origin, f64: the fade is done for all once `end - latest >= fade in`. */
  readonly latest: number;
}

/**
 * f32s a voice's timing block takes: its delays, its reach mask where it misses a subject, and its
 * subjects' fade-in origins where it staggers and `fades` in.
 */
export function sizeOf(answer: Answer, fades: boolean): number {
  const n = answer.delays?.length ?? 0;
  return n + (answer.reach?.length ?? 0) + (fades ? n : 0);
}

enum Dirty {
  NONE = 0,
  SHOWN = 1,
  ALL = 2,
}

/** The fields of a voice's clock that move its subjects' origins, as `reorigin`'s callers see them. */
function signatureOf(v: Voice<unknown, unknown>): unknown[] {
  return [
    v.state,
    v.start,
    v.anchorNow,
    v.anchorElapsed,
    v.rate,
    v.ramp,
    v.clocks?.length,
    v.opened,
    v.seeks,
  ];
}

/** One voice's timing block for one `register`: its f32s, and the f64 origins they are made from. */
class Block {
  readonly data: Float32Array;
  /** Where the origins start in `data`; -1 for none. */
  private readonly at: number;
  private readonly since: Float64Array | null;
  private readonly shown: Float64Array | null;
  private readonly sig: unknown[];
  anchor: number;
  latest = Number.NEGATIVE_INFINITY;
  dirty = Dirty.ALL;

  constructor(
    mix: Mixer<unknown, unknown>,
    private readonly voice: Voice<unknown, unknown>,
    readonly answer: Answer,
    now: number,
  ) {
    const { delays, reach } = answer;
    const fades = (voice.fade.in ?? 0) > 0;
    this.data = new Float32Array(sizeOf(answer, fades));
    const n = delays?.length ?? 0;
    if (delays !== null) this.data.set(delays);
    if (reach !== null) new Uint32Array(this.data.buffer).set(reach, n);
    this.at = delays !== null && fades ? n + (reach?.length ?? 0) : -1;
    this.sig = signatureOf(voice);
    this.anchor = now;
    if (this.at < 0 || delays === null) {
      this.since = null;
      this.shown = null;
      return;
    }
    this.since = new Float64Array(n);
    this.shown = new Float64Array(n);
    for (let i = 0; i < n; i++) this.since[i] = mix.sinceOf(voice, delays[i] as number);
    this.reshow(mix, now);
  }

  /** Where its clock moved since the last frame, moves the origins still ahead, as `reorigin` does. */
  follow(mix: Mixer<unknown, unknown>, now: number): void {
    const since = this.since;
    const delays = this.answer.delays;
    if (since === null || delays === null || !this.moved()) return;
    for (let i = 0; i < since.length; i++)
      if (!((since[i] as number) <= now)) since[i] = mix.sinceOf(this.voice, delays[i] as number);
    this.reshow(mix, now);
    if (this.dirty === Dirty.NONE) this.dirty = Dirty.SHOWN;
  }

  slotAt(offset: number): TimingSlot {
    const { delays, reach } = this.answer;
    const n = delays?.length ?? 0;
    return {
      delays: delays !== null ? offset : NONE,
      mask: reach !== null ? offset + n : NONE,
      shown: this.at >= 0 ? offset + this.at : NONE,
      anchor: this.anchor,
      latest: this.latest,
    };
  }

  /** The origins' range in `data`, in f32s. */
  get origins(): [number, number] {
    return [this.at, this.data.length];
  }

  /** Whether the voice's clock signature moved, taking the new one where it did. */
  private moved(): boolean {
    const now = signatureOf(this.voice);
    let moved = false;
    for (let k = 0; k < now.length; k++)
      if (!Object.is(now[k], this.sig[k])) {
        this.sig[k] = now[k];
        moved = true;
      }
    return moved;
  }

  private reshow(mix: Mixer<unknown, unknown>, now: number): void {
    const since = this.since as Float64Array;
    const shown = this.shown as Float64Array;
    const reach = this.answer.reach;
    let latest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < since.length; i++) {
      const s = mix.shownOf(this.voice, since[i] as number);
      shown[i] = s;
      this.data[this.at + i] = s - now;
      const reached = reach === null || (((reach[i >>> 5] as number) >>> (i & 31)) & 1) === 1;
      if (reached && s > latest) latest = s;
    }
    this.anchor = now;
    this.latest = latest;
  }
}

/**
 * The GPU side's timing blocks, one per staggered or partial voice it folds, laid end to end in
 * `persub` after the mirrors, in voice order: `[delays: n f32][mask: ceil(n/32) u32][shown: n f32]`,
 * each part only where the voice needs it.
 */
export class Timings {
  private readonly by = new Map<Voice<unknown, unknown>, Block>();
  private placed: { block: Block; offset: number }[] = [];
  /** Set where `placed` moved since the last upload, so all of it is written next. */
  private moved = true;
  /** f32s the blocks take. */
  length = 0;

  /** Lets go of every block; called from `GpuSide.subjects`. */
  clear(): void {
    this.by.clear();
    this.placed = [];
    this.moved = true;
    this.length = 0;
  }

  /** This frame's blocks, one per voice or undefined for one needing none, laid from `from`. */
  place<I>(
    mix: Mixer<I, unknown>,
    voices: readonly Voice<I, unknown>[],
    answers: Answers<I>,
    from: number,
  ): (TimingSlot | undefined)[] {
    const m = mix as Mixer<unknown, unknown>;
    const now = mix.now;
    const live = new Set<Voice<unknown, unknown>>();
    const placed: { block: Block; offset: number }[] = [];
    let at = from;
    const slots = voices.map((voice) => {
      const v = voice as Voice<unknown, unknown>;
      const answer = answers.of(voice);
      if (answer.delays === null && answer.reach === null) return undefined;
      live.add(v);
      let b = this.by.get(v);
      if (b === undefined || b.answer !== answer) {
        b = new Block(m, v, answer, now);
        this.by.set(v, b);
      } else b.follow(m, now);
      placed.push({ block: b, offset: at });
      const slot = b.slotAt(at);
      at += b.data.length;
      return slot;
    });
    for (const v of this.by.keys()) if (!live.has(v)) this.by.delete(v);
    const was = this.placed;
    if (
      placed.length !== was.length ||
      placed.some((p, k) => p.block !== was[k]?.block || p.offset !== was[k]?.offset)
    )
      this.moved = true;
    this.placed = placed;
    this.length = at - from;
    return slots;
  }

  /** Writes blocks that changed since the last upload, or all where `full`. */
  upload(device: GpuDevice, buffer: GpuBuffer, full: boolean): void {
    const all = full || this.moved;
    for (const { block, offset } of this.placed) {
      if (all || block.dirty === Dirty.ALL) {
        if (block.data.length > 0) device.queue.writeBuffer(buffer, offset * 4, block.data);
      } else if (block.dirty === Dirty.SHOWN) {
        const [from, to] = block.origins;
        device.queue.writeBuffer(buffer, (offset + from) * 4, block.data.subarray(from, to));
      }
      block.dirty = Dirty.NONE;
    }
    this.moved = false;
  }
}
