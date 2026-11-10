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
  /**
   * `subjects.length × axes` numbers; subject `i`'s axis `a` at `i * axes + a`. The array the read
   * was handed, where it was handed one that holds them; else one blits never writes again.
   */
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

/** A buffer of `bytes` the GPU copies into and the CPU maps to read. */
export function staging(device: GpuDevice, bytes: number, label: string): GpuBuffer {
  return device.createBuffer({ size: bytes, usage: Usage.MAP_READ | Usage.COPY_DST, label });
}

/** One copy from a GPU buffer into a staging buffer, in bytes. */
export interface Copy {
  readonly from: GpuBuffer;
  readonly offset: number;
  readonly at: number;
  readonly bytes: number;
}

/**
 * Submits `copies` into `into` and maps it to read: then `mapped(true)` once it is, or
 * `mapped(false)` where the map is refused, as on a device lost before it settles. Unmapping or
 * destroying `into` after is the caller's.
 */
export function mapCopy(
  device: GpuDevice,
  into: GpuBuffer,
  copies: readonly Copy[],
  mapped: (ok: boolean) => void,
): void {
  const enc = device.createCommandEncoder();
  for (const c of copies) enc.copyBufferToBuffer(c.from, c.offset, into, c.at, c.bytes);
  device.queue.submit([enc.finish()]);
  into.mapAsync(MAP_READ).then(
    () => mapped(true),
    () => mapped(false),
  );
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

/**
 * One channel's copy out of one fold: its values in an array the readback reuses, kept while the
 * copy is held or a read is still taking them.
 */
interface Shot<I> {
  readonly name: string;
  readonly meta: Omit<GpuRead<I>, 'values'>;
  values: Float32Array | null;
  /** Reads still taking the values. */
  takers: number;
  /** Of `takers`, those handed no array. */
  bare: number;
  held: boolean;
  /** The read handed out to reads given no array, made at the first. */
  fresh: GpuRead<I> | null;
}

/** The newest copy of one channel, and the fold it came from. */
interface Held<I> {
  readonly frame: number;
  readonly seq: number;
  readonly shot: Shot<I>;
  /** Whether the copy mapped. */
  readonly done: Promise<boolean>;
}

/** The most spare arrays the readback keeps a channel. */
const SPARE = 2;

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
  /** Arrays a channel's copies left, to copy the next into. */
  private readonly spare = new Map<string, Float32Array[]>();
  private readonly slots: Slot[] = [];
  /** Staging buffers made for a single read, destroyed once it maps. */
  private readonly loose = new Set<GpuBuffer>();
  /** How to resolve each copy still mapping. */
  private readonly waiting = new Set<() => void>();
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
   * take it. Lets go of the copies of channels not wanted that are too old for `read` to give, and
   * clears `want`.
   */
  turn(frame: number, seq: number): void {
    const f = this.last;
    if (this.closed || f === null || f.frame >= frame) return;
    for (const [name, h] of this.held)
      if (!this.wanted.has(name) && h.seq < seq - 1) this.unhold(name);
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
   * resolves with zeros before the loss is reported may still reach the host. Copies the values into
   * `into` where it holds them all.
   */
  read(name: string, frame: number, seq: number, into?: Float32Array): Promise<GpuRead<I> | null> {
    if (this.closed) return Promise.resolve(null);
    let h = this.held.get(name);
    if (
      h === undefined ||
      !(h.frame === frame || (h.frame < frame && (h.seq >= seq - 1 || this.skipped === frame)))
    ) {
      const f = this.last;
      if (f === null || !f.outputs.has(name)) return Promise.resolve(null);
      const parts = layout(f, [name]);
      this.copy(f, parts, this.slot(size(parts)));
      h = this.held.get(name) as Held<I>;
    }
    const shot = h.shot;
    shot.takers++;
    const bare = into === undefined;
    if (bare) shot.bare++;
    return h.done.then((mapped) => {
      shot.takers--;
      if (bare) shot.bare--;
      const values = shot.values;
      const read = mapped && values !== null ? this.take(shot, values, into) : null;
      this.release(shot);
      return read;
    });
  }

  /** A shot's values as a read: in `into` where it holds them, else in the shot's own copy. */
  private take(shot: Shot<I>, values: Float32Array, into?: Float32Array): GpuRead<I> {
    if (into !== undefined && into.length >= values.length) {
      into.set(values);
      const out = into.length === values.length ? into : into.subarray(0, values.length);
      return { ...shot.meta, values: out };
    }
    shot.fresh ??= { ...shot.meta, values: values.slice() };
    return shot.fresh;
  }

  /** Lets go of `name`'s held copy. */
  private unhold(name: string): void {
    const h = this.held.get(name);
    if (h === undefined) return;
    this.held.delete(name);
    h.shot.held = false;
    this.release(h.shot);
  }

  /** Gives a shot's array back for the next copy, once nothing holds or takes it. */
  private release(shot: Shot<I>): void {
    if (shot.held || shot.takers > 0 || shot.values === null) return;
    // A shot copied straight into its fresh read's array has none of the readback's to give back.
    if (shot.fresh === null || shot.fresh.values !== shot.values) {
      const spare = this.spare.get(shot.name) ?? [];
      if (!this.closed && spare.length < SPARE) spare.push(shot.values);
      this.spare.set(shot.name, spare);
    }
    shot.values = null;
  }

  /** An array of `length` for `name`'s next copy, reusing a spare. */
  private array(name: string, length: number): Float32Array {
    const spare = this.spare.get(name);
    while (spare !== undefined && spare.length > 0) {
      const a = spare.pop() as Float32Array;
      if (a.length === length) return a;
    }
    return new Float32Array(length);
  }

  /** Forgets the last fold and the frame's copies (subjects() was called). */
  forget(): void {
    this.last = null;
    this.copied = new Set();
    for (const name of [...this.held.keys()]) this.unhold(name);
    this.skipped = Number.NaN;
  }

  /**
   * Resolves waiting reads with null and answers null from now on; destroys the staging buffers
   * where `destroy`. Only the first call does anything.
   */
  close(destroy: boolean): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiting) resolve();
    this.waiting.clear();
    if (destroy) {
      for (const s of this.slots) s.buffer.destroy();
      for (const b of this.loose) b.destroy();
    }
    this.slots.length = 0;
    this.loose.clear();
    this.held.clear();
    this.spare.clear();
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
    return staging(this.device, bytes, 'blits gpu readback');
  }

  /** Copies `parts` of `f` into `slot`, or into a buffer of their own where it is null, and maps it. */
  private copy(f: Fold<I>, parts: readonly Part[], slot: Slot | null): void {
    const buffer = slot?.buffer ?? this.make(size(parts));
    if (slot === null) this.loose.add(buffer);
    const { now, timestamp, list: subjects } = f;
    const shots = parts.map(
      (p): Shot<I> => ({
        name: p.name,
        meta: { axes: p.axes, now, timestamp, subjects },
        values: null,
        takers: 0,
        bare: 0,
        held: true,
        fresh: null,
      }),
    );
    let resolve: (mapped: boolean) => void = () => {};
    const done = new Promise<boolean>((r) => {
      resolve = r;
    });
    const close = () => resolve(false);
    this.waiting.add(close);
    const end = (mapped: boolean) => {
      this.waiting.delete(close);
      if (this.closed) return resolve(false);
      let ok = false;
      try {
        if (mapped) {
          const range = buffer.getMappedRange();
          parts.forEach((p, i) => {
            const shot = shots[i] as Shot<I>;
            if (!shot.held && shot.takers === 0) return;
            const from = new Float32Array(range, p.at, p.bytes / 4);
            if (shot.bare > 0) {
              // A read handed no array is waiting: its array is the one copy, and the rest copy from it.
              shot.fresh = { ...shot.meta, values: from.slice() };
              shot.values = shot.fresh.values;
              return;
            }
            const values = this.array(p.name, p.bytes / 4);
            values.set(from);
            shot.values = values;
          });
          ok = true;
        }
      } catch (err) {
        errorOnce(this, `a gpu read could not copy its values out, so it resolves null: ${err}`);
      } finally {
        if (mapped) buffer.unmap();
        if (slot !== null) slot.busy = false;
        else {
          this.loose.delete(buffer);
          buffer.destroy();
        }
        resolve(ok);
      }
    };
    mapCopy(
      this.device,
      buffer,
      parts.map((p) => ({ from: f.out, offset: p.offset, at: p.at, bytes: p.bytes })),
      end,
    );
    parts.forEach((p, i) => {
      this.copied.add(p.name);
      this.unhold(p.name);
      this.held.set(p.name, { frame: f.frame, seq: f.seq, shot: shots[i] as Shot<I>, done });
    });
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
