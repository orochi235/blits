import { curveData, straight } from '../easing.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answer, type Answers, varies } from './answers.js';
import { type Laid, lay, moved } from './lay.js';
import type { Entry } from './region.js';
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
 * f32s a voice's timing block takes: its delays, its reach mask where some registered subject is
 * not reached, and its subjects' fade-in origins where it staggers and `fades` in.
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

/** One voice's timing block for one `register`: its f32s, and the f64 origins they are made from. */
class Block {
  readonly data: Float32Array;
  /** Where the origins start in `data`; -1 for none. */
  private readonly at: number;
  /** 1 where a subject's record would be on its voice's `early` list. */
  private readonly early: Uint8Array | null;
  /** How many of `early` are 1. */
  private listed = 0;
  private readonly shown: Float64Array | null;
  /** Set where an origin moved since `data` last took them, so the next `place` lays them again. */
  private stale = false;
  /** The voice's fade curve as `blits_ease` reads it, where it fades its origins in on one. */
  readonly curve: Float32Array | null;
  anchor: number;
  latest = Number.NEGATIVE_INFINITY;
  dirty = Dirty.ALL;
  /** The voice's `seeks` when this was made: a seek puts its records back, which origins follow. */
  readonly seeks: number;

  constructor(
    mix: Mixer<unknown, unknown>,
    private readonly voice: Voice<unknown, unknown>,
    readonly answer: Answer,
    now: number,
  ) {
    const { delays, reach } = answer;
    const fades = (voice.fade.in ?? 0) > 0;
    this.seeks = voice.seeks;
    this.data = new Float32Array(sizeOf(answer, fades));
    const n = delays?.length ?? 0;
    if (delays !== null) this.data.set(delays);
    if (reach !== null) new Uint32Array(this.data.buffer).set(reach, n);
    this.at = delays !== null && fades ? n + (reach?.length ?? 0) : -1;
    const curve = this.at >= 0 && !straight(voice.ease) ? curveData(voice.ease) : undefined;
    this.curve = curve === undefined ? null : Float32Array.from(curve);
    this.anchor = now;
    if (this.at < 0 || delays === null) {
      this.early = null;
      this.shown = null;
      return;
    }
    this.early = new Uint8Array(n);
    this.shown = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const since = mix.sinceOf(voice, delays[i] as number);
      this.early[i] = since <= now ? 0 : 1;
      this.listed += this.early[i] as number;
      this.shown[i] = mix.shownOf(voice, since);
    }
    this.lay(now);
  }

  /**
   * The voice's clock changed at `now`: the listed origins count from where the clock now puts
   * them, and stay listed while still ahead of `now`, as `reorigin` moves its `early` records.
   */
  reorigin(mix: Mixer<unknown, unknown>, now: number): void {
    const { early, shown } = this;
    const delays = this.answer.delays;
    if (early === null || shown === null || delays === null || this.listed === 0) return;
    for (let i = 0; i < early.length; i++) {
      if (early[i] === 0) continue;
      const s = mix.sinceOf(this.voice, delays[i] as number);
      // A motion voice's record stays listed until read past its origin, which the GPU never does.
      if (this.voice.motion === undefined && s <= now) {
        early[i] = 0;
        this.listed--;
      }
      shown[i] = mix.shownOf(this.voice, s);
      this.stale = true;
    }
  }

  /** Lays origins that moved since the last frame, against `now`. */
  follow(now: number): void {
    if (!this.stale) return;
    this.lay(now);
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

  /** Each subject's fade-in origin by registration order, mix times; null where the block keeps none. */
  get origins(): Float64Array | null {
    return this.shown;
  }

  /** The origins' range in `data`, in f32s. */
  get range(): [number, number] {
    return [this.at, this.data.length];
  }

  private lay(now: number): void {
    const shown = this.shown as Float64Array;
    const reach = this.answer.reach;
    let latest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i] as number;
      this.data[this.at + i] = s - now;
      const reached = reach === null || (((reach[i >>> 5] as number) >>> (i & 31)) & 1) === 1;
      if (reached && s > latest) latest = s;
    }
    this.anchor = now;
    this.latest = latest;
    this.stale = false;
  }
}

/**
 * The GPU side's timing blocks, one per staggered or partial voice it folds, laid end to end in
 * `persub` after the mirrors, in voice order: `[delays: n f32][mask: ceil(n/32) u32][shown: n f32]`,
 * each part only where the voice needs it.
 */
export class Timings {
  private readonly by = new Map<Voice<unknown, unknown>, Block>();
  private placed: Laid<Block>[] = [];
  /** Set where `placed` moved since the last upload, so all of it is written next. */
  private moved = true;
  /** The mix whose clock changes this hears, and the `reorigined` hook it set there. */
  private hooked: Mixer<unknown, unknown> | null = null;
  private hook: Mixer<unknown, unknown>['reorigined'] = null;
  /** f32s the blocks take. */
  length = 0;

  /** Lets go of every block; called from `GpuSide.subjects`. */
  clear(): void {
    this.by.clear();
    this.placed = [];
    this.moved = true;
    this.length = 0;
  }

  /** Lets go of every block and stops hearing the mix's clock changes. */
  close(): void {
    this.clear();
    const m = this.hooked;
    if (m !== null && m.reorigined === this.hook) m.reorigined = null;
    this.hooked = null;
    this.hook = null;
  }

  /** `voice`'s block for this frame, made where it has none for `answer`; undefined where it needs none. */
  private blockOf<I>(mix: Mixer<I, unknown>, voice: Voice<I, unknown>, answers: Answers<I>) {
    const m = mix as Mixer<unknown, unknown>;
    if (this.hooked !== m) {
      this.hook = (voice, t) => this.by.get(voice)?.reorigin(m, t);
      m.reorigined = this.hook;
      this.hooked = m;
    }
    const v = voice as Voice<unknown, unknown>;
    if (!varies(v)) return undefined;
    const answer = answers.of(voice);
    if (answer.delays === null && answer.reach === null) return undefined;
    let b = this.by.get(v);
    if (b === undefined || b.answer !== answer || b.seeks !== v.seeks) {
      b = new Block(m, v, answer, mix.now);
      this.by.set(v, b);
    } else b.follow(mix.now);
    return b;
  }

  /**
   * Each registered subject's fade-in origin for `voice` this frame, mix times by registration
   * order, as the GPU fades them in from; null where the voice does not both stagger and fade in.
   */
  originsOf<I>(
    mix: Mixer<I, unknown>,
    voice: Voice<I, unknown>,
    answers: Answers<I>,
  ): Float64Array | null {
    return this.blockOf(mix, voice, answers)?.origins ?? null;
  }

  /** This frame's blocks, one per voice or undefined for one needing none, laid from `from`. */
  place<I>(
    mix: Mixer<I, unknown>,
    voices: readonly Voice<I, unknown>[],
    answers: Answers<I>,
    from: number,
  ): (TimingSlot | undefined)[] {
    const live = new Set<Voice<unknown, unknown>>();
    const blocks = voices.map((voice) => {
      const b = this.blockOf(mix, voice, answers);
      if (b !== undefined) live.add(voice as Voice<unknown, unknown>);
      return b;
    });
    for (const v of this.by.keys()) if (!live.has(v)) this.by.delete(v);
    const { placed, offsets, end } = lay(blocks, from, (b) => b.data.length);
    if (moved(this.placed, placed)) this.moved = true;
    this.placed = placed;
    this.length = end - from;
    return blocks.map((b, k) => b?.slotAt(offsets[k] as number));
  }

  /** The fade curve of `voice`'s block as a values entry the block owns, where it has one. */
  curveOf(voice: Voice<unknown, unknown>): Entry | undefined {
    const b = this.by.get(voice);
    return b?.curve ? { owner: b, values: b.curve } : undefined;
  }

  /** Writes blocks that changed since the last upload, or all where `full`. */
  upload(device: GpuDevice, buffer: GpuBuffer, full: boolean): void {
    const all = full || this.moved;
    for (const { item: block, offset } of this.placed) {
      if (all || block.dirty === Dirty.ALL) {
        if (block.data.length > 0) device.queue.writeBuffer(buffer, offset * 4, block.data);
      } else if (block.dirty === Dirty.SHOWN) {
        const [from, to] = block.range;
        device.queue.writeBuffer(buffer, (offset + from) * 4, block.data.subarray(from, to));
      }
      block.dirty = Dirty.NONE;
    }
    this.moved = false;
  }
}
