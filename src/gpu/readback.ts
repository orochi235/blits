import { errorOnce } from '../warn.js';
import type { GpuChannel } from './side.js';
import { type GpuBuffer, type GpuDevice, MAP_READ, Usage } from './webgpu.js';

/**
 * One channel's folded values, copied back from the GPU: the registered subjects in the order the
 * fold used, each with the channel's `axes` numbers.
 *
 * @category gpu
 */
export interface GpuRead<I> {
  /** `subjects.length × axes` numbers; subject `i`'s axis `a` at `i * axes + a`. Never written again. */
  readonly values: Float32Array;
  readonly axes: number;
  /** The mix time of the fold these came from. */
  readonly now: number;
  /** The host's timestamp at that frame's sync. */
  readonly timestamp: number;
  /** The registered subjects the fold used, in its order. */
  readonly subjects: readonly I[];
}

/** A fold the side made: where its channels sit, and when it was made. */
export interface Fold<I> {
  readonly out: GpuBuffer;
  readonly outputs: ReadonlyMap<string, GpuChannel>;
  /** `mix.frame` when it folded. */
  readonly frame: number;
  /** `mix.seq` when it folded. */
  readonly seq: number;
  readonly now: number;
  readonly timestamp: number;
  readonly list: readonly I[];
}

/** The most staging buffers the ring holds. */
export const SLOTS = 3;

interface Slot {
  buffer: GpuBuffer;
  busy: boolean;
}

/** Where one channel goes in a staging buffer. */
interface Part {
  readonly name: string;
  readonly offset: number;
  readonly axes: number;
  readonly at: number;
  readonly bytes: number;
}

/** The newest copy of one channel, and the fold it came from. */
interface Held<I> {
  readonly frame: number;
  readonly seq: number;
  readonly read: Promise<GpuRead<I> | null>;
}

/**
 * Copies a fold's read channels into a ring of mapped staging buffers. A frame whose copy finds no
 * free buffer skips it rather than wait, and reads keep the copy they had.
 */
export class Readback<I> {
  private readonly wanted = new Set<string>();
  private last: Fold<I> | null = null;
  /** The channels of `last` copied so far. */
  private copied = new Set<string>();
  private readonly held = new Map<string, Held<I>>();
  private readonly slots: Slot[] = [];
  /** Staging buffers made for a single read, destroyed once it maps. */
  private readonly loose = new Set<GpuBuffer>();
  /** How to resolve each copy still mapping. */
  private readonly waiting = new Set<(reads: null) => void>();
  /** The frame whose turn found every slot busy. */
  private skipped = Number.NaN;
  private closed = false;

  constructor(private readonly device: GpuDevice) {}

  /** Marks `name` read since the last copy, so the next turn copies it. */
  want(name: string): void {
    if (!this.closed) this.wanted.add(name);
  }

  /** Records the side's newest fold. */
  fold(f: Fold<I>): void {
    if (this.closed) return;
    this.last = f;
    this.copied = new Set();
  }

  /**
   * At a frame's first refresh, before anything is written: copies the last fold's wanted channels,
   * if it is another frame's, not yet copied, and at most one `seq` before `seq`, as `read` would
   * take it. Lets go of the copies of channels not wanted, and clears `want`.
   */
  turn(frame: number, seq: number): void {
    const f = this.last;
    if (this.closed || f === null || f.frame >= frame) return;
    for (const name of this.held.keys()) if (!this.wanted.has(name)) this.held.delete(name);
    const names =
      f.seq >= seq - 1
        ? [...this.wanted].filter((n) => f.outputs.has(n) && !this.copied.has(n))
        : [];
    this.wanted.clear();
    if (names.length === 0) return;
    const parts = layout(f, names);
    const slot = this.slot(size(parts));
    if (slot === null) this.skipped = frame;
    else this.copy(f, parts, slot);
  }

  /**
   * The newest copy of `name` from a fold before `frame`, if that fold was made at most one `seq`
   * before `seq` or this frame's turn was skipped; else the current fold, copied now. Resolves `null`
   * when there is no fold holding `name`, and never rejects. On a real device loss, a map that
   * resolves with zeros before the loss is reported may still reach the host.
   */
  read(name: string, frame: number, seq: number): Promise<GpuRead<I> | null> {
    if (this.closed) return Promise.resolve(null);
    const h = this.held.get(name);
    if (
      h !== undefined &&
      (h.frame === frame || (h.frame < frame && (h.seq >= seq - 1 || this.skipped === frame)))
    )
      return h.read;
    const f = this.last;
    if (f === null || !f.outputs.has(name)) return Promise.resolve(null);
    const parts = layout(f, [name]);
    this.copy(f, parts, this.slot(size(parts)));
    return (this.held.get(name) as Held<I>).read;
  }

  /** Forgets the last fold and the frame's copies (subjects() was called). */
  forget(): void {
    this.last = null;
    this.copied = new Set();
    this.held.clear();
    this.skipped = Number.NaN;
  }

  /**
   * Resolves waiting reads with null and answers null from now on; destroys the staging buffers
   * where `destroy`. Only the first call does anything.
   */
  close(destroy: boolean): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiting) resolve(null);
    this.waiting.clear();
    if (destroy) {
      for (const s of this.slots) s.buffer.destroy();
      for (const b of this.loose) b.destroy();
    }
    this.slots.length = 0;
    this.loose.clear();
    this.held.clear();
    this.wanted.clear();
    this.last = null;
  }

  /** A free slot that holds `bytes`, remaking a smaller one or adding one while there are fewer than `SLOTS`. */
  private slot(bytes: number): Slot | null {
    const free = this.slots.filter((s) => !s.busy);
    let s = free.find((f) => f.buffer.size >= bytes);
    if (s === undefined && free[0] !== undefined) {
      s = free[0];
      s.buffer.destroy();
      s.buffer = this.make(bytes);
    } else if (s === undefined && this.slots.length < SLOTS) {
      s = { buffer: this.make(bytes), busy: false };
      this.slots.push(s);
    }
    if (s === undefined) return null;
    s.busy = true;
    return s;
  }

  private make(bytes: number): GpuBuffer {
    return this.device.createBuffer({
      size: bytes,
      usage: Usage.MAP_READ | Usage.COPY_DST,
      label: 'blits gpu readback',
    });
  }

  /** Copies `parts` of `f` into `slot`, or into a buffer of their own where it is null, and maps it. */
  private copy(f: Fold<I>, parts: readonly Part[], slot: Slot | null): void {
    const buffer = slot?.buffer ?? this.make(size(parts));
    if (slot === null) this.loose.add(buffer);
    const enc = this.device.createCommandEncoder();
    for (const p of parts) enc.copyBufferToBuffer(f.out, p.offset, buffer, p.at, p.bytes);
    this.device.queue.submit([enc.finish()]);
    let resolve: (reads: Map<string, GpuRead<I>> | null) => void = () => {};
    const done = new Promise<Map<string, GpuRead<I>> | null>((r) => {
      resolve = r;
    });
    this.waiting.add(resolve);
    const end = (mapped: boolean) => {
      this.waiting.delete(resolve);
      if (this.closed) return resolve(null);
      let reads: Map<string, GpuRead<I>> | null = null;
      try {
        if (mapped) {
          const range = buffer.getMappedRange();
          const got = new Map<string, GpuRead<I>>();
          for (const p of parts) {
            const values = new Float32Array(range.slice(p.at, p.at + p.bytes));
            const { now, timestamp, list: subjects } = f;
            got.set(p.name, { values, axes: p.axes, now, timestamp, subjects });
          }
          reads = got;
        }
      } catch (err) {
        reads = null;
        errorOnce(this, `a gpu read could not copy its values out, so it resolves null: ${err}`);
      } finally {
        if (mapped) buffer.unmap();
        if (slot !== null) slot.busy = false;
        else {
          this.loose.delete(buffer);
          buffer.destroy();
        }
        resolve(reads);
      }
    };
    buffer.mapAsync(MAP_READ).then(
      () => end(true),
      () => end(false),
    );
    for (const p of parts) {
      this.copied.add(p.name);
      const read = done.then((reads) => reads?.get(p.name) ?? null);
      this.held.set(p.name, { frame: f.frame, seq: f.seq, read });
    }
  }
}

/** Packs `names` back to back, each `list.length × axes` floats. */
function layout<I>(f: Fold<I>, names: readonly string[]): Part[] {
  let at = 0;
  return names.map((name) => {
    const c = f.outputs.get(name) as GpuChannel;
    if (c.stride !== c.axes * 4)
      throw new Error(`blits: gpu channel ${name} has stride ${c.stride}, not ${c.axes * 4}`);
    const bytes = f.list.length * c.axes * 4;
    const part = { name, offset: c.offset, axes: c.axes, at, bytes };
    at += bytes;
    return part;
  });
}

function size(parts: readonly Part[]): number {
  const p = parts[parts.length - 1] as Part;
  return p.at + p.bytes;
}
