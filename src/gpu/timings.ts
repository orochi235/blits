import { curveData, straight } from '../easing.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answer, type Answers, varies } from './answers.js';
import { type Laid, lay, moved } from './lay.js';
import { type Levels, levelsOf } from './levels.js';
import { Origins } from './origins.js';
import type { Entry } from './region.js';
import { type GpuBuffer, type GpuCommandEncoder, type GpuDevice, Usage } from './webgpu.js';
import { NONE } from './wgsl/timing.js';

/** Where a voice's timing block sits in `persub`, in f32s; NONE for a part it has none of. */
export interface TimingSlot {
  /** Its delays: one per level where `codes` is set, else one per subject. */
  readonly delays: number;
  readonly mask: number;
  /** Its fade-in origins, less `anchor`, laid as `delays` are. */
  readonly shown: number;
  /** Each subject's level, a u16, two to a u32; NONE where each subject is its own level. */
  readonly codes: number;
  /** The mix time `shown` counts from (f64; never sent to the GPU itself). */
  readonly anchor: number;
  /** The latest subject's fade-in origin, f64: the fade is done for all once `end - latest >= fade in`. */
  readonly latest: number;
}

/**
 * f32s a voice's timing block takes: a delay per level, its reach mask where some registered
 * subject is not reached, a fade-in origin per level where it `fades` in, and each subject's level.
 */
export function sizeOf(answer: Answer, fades: boolean): number {
  const { delays, reach } = answer;
  const levels = delays === null ? null : levelsOf(delays);
  const k = levels?.values.length ?? 0;
  return k + (reach?.length ?? 0) + (fades ? k : 0) + codeWords(levels);
}

/** u32s a block's level codes take. */
const codeWords = (levels: Levels | null): number =>
  levels?.codes == null ? 0 : levels.codes.length >>> 1;

/**
 * Bytes of level codes past which a block's codes go up once into a buffer of their own, copied
 * into `persub` on the GPU wherever the block is laid.
 */
const OWN = 1 << 16;

enum Dirty {
  NONE = 0,
  SHOWN = 1,
  ALL = 2,
}

/**
 * One voice's timing block for one `register`: its f32s, and the f64 origins they are made from.
 * Origins, `early` and reach follow from a subject's delay alone, so all are kept per level.
 */
class Block {
  /** The levels' delays, the reach mask, and the levels' origins; the codes follow it in `persub`. */
  readonly data: Float32Array;
  /** Where the origins start in `data`; -1 for none. */
  private readonly at: number;
  readonly levels: Levels | null;
  /** Per level, 1 where its subjects' records would be on the voice's `early` list. */
  private readonly early: Uint8Array | null;
  /** How many levels' records would be on `early`. */
  private listed = 0;
  /** Per level, the subjects' fade-in origin. */
  private readonly shown: Float64Array | null;
  /** Per level, 1 where some subject at it is reached; null where every subject is. */
  private readonly reached: Uint8Array | null;
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
    readonly voice: Voice<unknown, unknown>,
    readonly answer: Answer,
    now: number,
  ) {
    const { delays, reach } = answer;
    const fades = (voice.fade.in ?? 0) > 0;
    this.seeks = voice.seeks;
    const levels = delays === null ? null : levelsOf(delays);
    this.levels = levels;
    const k = levels?.values.length ?? 0;
    const words = reach?.length ?? 0;
    this.data = new Float32Array(k + words + (fades ? k : 0));
    if (levels !== null) this.data.set(levels.values);
    if (reach !== null) new Uint32Array(this.data.buffer).set(reach, k);
    this.at = levels !== null && fades ? k + words : -1;
    const curve = this.at >= 0 && !straight(voice.ease) ? curveData(voice.ease) : undefined;
    this.curve = curve === undefined ? null : Float32Array.from(curve);
    this.anchor = now;
    if (this.at < 0 || levels === null) {
      this.early = null;
      this.shown = null;
      this.reached = null;
      return;
    }
    const { values, codes } = levels;
    this.early = new Uint8Array(k);
    this.shown = new Float64Array(k);
    const at = new Origins(mix, voice);
    for (let l = 0; l < k; l++) {
      const since = at.since(values[l] as number);
      const early = since <= now ? 0 : 1;
      this.early[l] = early;
      this.listed += early;
      this.shown[l] = at.shown(since);
    }
    if (reach === null) this.reached = null;
    else {
      const reached = new Uint8Array(k);
      const n = delays?.length ?? 0;
      for (let i = 0; i < n; i++)
        if ((((reach[i >>> 5] as number) >>> (i & 31)) & 1) === 1)
          reached[codes === null ? i : (codes[i] as number)] = 1;
      this.reached = reached;
    }
    this.lay(now);
  }

  /** f32s the block takes in `persub`: `data`, then the codes. */
  get size(): number {
    return this.data.length + codeWords(this.levels);
  }

  /**
   * The voice's clock changed at `now`: the listed origins count from where the clock now puts
   * them, and stay listed while still ahead of `now`, as `reorigin` moves its `early` records.
   */
  reorigin(mix: Mixer<unknown, unknown>, now: number): void {
    const { early, shown, levels } = this;
    if (early === null || shown === null || levels === null || this.listed === 0) return;
    const { values } = levels;
    const at = new Origins(mix, this.voice);
    for (let l = 0; l < early.length; l++) {
      if (early[l] === 0) continue;
      const s = at.since(values[l] as number);
      // A motion voice's record stays listed until read past its origin, which the GPU never does.
      if (this.voice.motion === undefined && s <= now) {
        early[l] = 0;
        this.listed--;
      }
      shown[l] = at.shown(s);
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
    const { levels, data } = this;
    const k = levels?.values.length ?? 0;
    return {
      delays: levels !== null ? offset : NONE,
      mask: this.answer.reach !== null ? offset + k : NONE,
      shown: this.at >= 0 ? offset + this.at : NONE,
      codes: levels?.codes == null ? NONE : offset + data.length,
      anchor: this.anchor,
      latest: this.latest,
    };
  }

  /** Registered subject `row`'s fade-in origin, a mix time; NaN where the block keeps none. */
  originAt(row: number): number {
    const { shown, levels } = this;
    if (shown === null || levels === null) return Number.NaN;
    const codes = levels.codes;
    return shown[codes === null ? row : (codes[row] as number)] ?? Number.NaN;
  }

  /** The origins' range in `data`, in f32s. */
  get range(): [number, number] {
    return [this.at, this.data.length];
  }

  /**
   * Writes all of the block at `offset` in f32s: `data`, then the codes, which never change,
   * copied from `sent` where they have a buffer of their own.
   */
  write(
    device: GpuDevice,
    enc: GpuCommandEncoder,
    buffer: GpuBuffer,
    offset: number,
    sent: GpuBuffer | null,
  ): void {
    const { data } = this;
    if (data.length > 0) device.queue.writeBuffer(buffer, offset * 4, data);
    const codes = this.levels?.codes;
    if (codes == null || codes.length === 0) return;
    const at = (offset + data.length) * 4;
    if (sent !== null) enc.copyBufferToBuffer(sent, 0, buffer, at, codes.byteLength);
    else device.queue.writeBuffer(buffer, at, codes);
  }

  private lay(now: number): void {
    const shown = this.shown as Float64Array;
    const { data, at, reached } = this;
    let latest = Number.NEGATIVE_INFINITY;
    for (let l = 0; l < shown.length; l++) {
      const s = shown[l] as number;
      data[at + l] = s - now;
      if ((reached === null || reached[l] === 1) && s > latest) latest = s;
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
  /**
   * Level codes past `OWN` bytes in a buffer of their own, each kept until its voice is done or
   * its block lays other levels.
   */
  private readonly sent = new Map<Levels, { buffer: GpuBuffer; voice: Voice<unknown, unknown> }>();
  /** f32s the blocks take. */
  length = 0;

  /** Lets go of every block; called from `GpuSide.subjects`. */
  clear(): void {
    this.by.clear();
    this.placed = [];
    this.moved = true;
    this.length = 0;
  }

  /** Lets go of every block and codes buffer, and stops hearing the mix's clock changes. */
  close(): void {
    this.clear();
    for (const s of this.sent.values()) s.buffer.destroy();
    this.sent.clear();
    const m = this.hooked;
    if (m !== null && m.reorigined === this.hook) m.reorigined = null;
    this.hooked = null;
    this.hook = null;
  }

  /**
   * Works out the levels of a voice cued with a named stagger, and sends its codes up where they
   * take a buffer of their own, so the frame it starts in does neither.
   */
  stage<I>(device: GpuDevice, voice: Voice<I, unknown>): void {
    const ordered = voice.named?.ordered;
    if (ordered != null) this.sentOf(device, levelsOf(ordered), voice as Voice<unknown, unknown>);
  }

  private sentOf(
    device: GpuDevice,
    levels: Levels | null,
    voice: Voice<unknown, unknown>,
  ): GpuBuffer | null {
    const codes = levels?.codes;
    if (levels == null || codes == null || codes.byteLength < OWN) return null;
    let s = this.sent.get(levels);
    if (s === undefined) {
      const buffer = device.createBuffer({
        size: codes.byteLength,
        usage: Usage.COPY_SRC,
        mappedAtCreation: true,
        label: 'blits gpu codes',
      });
      new Uint16Array(buffer.getMappedRange()).set(codes);
      buffer.unmap();
      s = { buffer, voice };
      this.sent.set(levels, s);
    }
    return s.buffer;
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
   * Each registered subject's fade-in origin for `voice` this frame, a mix time by its row, as the
   * GPU fades it in from; null where the voice does not both stagger and fade in.
   */
  originsOf<I>(
    mix: Mixer<I, unknown>,
    voice: Voice<I, unknown>,
    answers: Answers<I>,
  ): ((row: number) => number) | null {
    const b = this.blockOf(mix, voice, answers);
    return b === undefined ? null : (row) => b.originAt(row);
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
    for (const [levels, s] of this.sent)
      if (s.voice.state === 'done' || (this.by.get(s.voice)?.levels ?? levels) !== levels) {
        s.buffer.destroy();
        this.sent.delete(levels);
      }
    const { placed, offsets, end } = lay(blocks, from, (b) => b.size);
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
  upload(device: GpuDevice, enc: GpuCommandEncoder, buffer: GpuBuffer, full: boolean): void {
    const all = full || this.moved;
    for (const { item: block, offset } of this.placed) {
      if (all || block.dirty === Dirty.ALL)
        block.write(device, enc, buffer, offset, this.sentOf(device, block.levels, block.voice));
      else if (block.dirty === Dirty.SHOWN) {
        const [from, to] = block.range;
        device.queue.writeBuffer(buffer, (offset + from) * 4, block.data.subarray(from, to));
      }
      block.dirty = Dirty.NONE;
    }
    this.moved = false;
  }
}
