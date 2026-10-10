import { foldNumber, lerpNumber, type Numeric } from './channels.js';
import type { Curve } from './easing.js';
import { type Built, fraction, locate, shift } from './patch.js';

/** What a keys row folds into: a laned channel's arithmetic, axes, rest and values. */
export interface KeyChannel {
  scalar: boolean;
  op: Numeric['op'];
  plain: boolean;
  rest: number;
  axes: number;
  values: Float64Array;
}

/** A row's header: its length in `data`, its offset in `eases`, its duration, its stop count. */
const HEAD = 4;

/**
 * The stops of a crowd's `keys` rows, copied into one array as a row joins, so a fill reads each
 * row's stops in place rather than through its voice, its built tracks and every stop's own array.
 * Per row: its header, then per track its stop count, its delay, and per stop its phase and its
 * value on each of the channel's axes, a missing axis read as rest as `vec`'s lerp reads it. Each
 * stop's easing is in `eases`.
 */
export class KeyRows {
  data = new Float64Array(64);
  used = 0;
  eases: (Curve | undefined)[] = [];

  /**
   * Copies a voice's stops for channels `chans` and returns the row's offset; -1 where a stop's
   * value is not one a lane folds as a number per axis, so the row reads its voice's stops instead.
   */
  add(built: Built, chans: readonly KeyChannel[]): number {
    let len = HEAD;
    let stops = 0;
    for (let i = 0; i < built.tracks.length; i++) {
      const track = built.tracks[i];
      const ch = chans[i];
      if (track === undefined || ch === undefined || !ch.plain) return -1;
      for (const pt of track.all) if (!flat(pt.value, ch)) return -1;
      len += 2 + track.all.length * (1 + ch.axes);
      stops += track.all.length;
    }
    const off = this.reserve(len);
    const d = this.data;
    d[off] = len;
    d[off + 1] = this.eases.length;
    d[off + 2] = built.duration;
    d[off + 3] = stops;
    let o = off + HEAD;
    for (let i = 0; i < built.tracks.length; i++) {
      const track = built.tracks[i] as Built['tracks'][number];
      const ch = chans[i] as KeyChannel;
      d[o++] = track.all.length;
      d[o++] = track.delay;
      for (const pt of track.all) {
        d[o++] = pt.at;
        if (ch.scalar) d[o++] = pt.value as number;
        else {
          const arr = pt.value as ArrayLike<number>;
          for (let a = 0; a < ch.axes; a++) d[o++] = arr[a] ?? ch.rest;
        }
        this.eases.push(pt.ease);
      }
    }
    return off;
  }

  /** Copies another pool's row at `off` into this one, returning its offset here. */
  copy(from: KeyRows, off: number): number {
    const len = from.data[off] as number;
    const at = this.reserve(len);
    this.data.set(from.data.subarray(off, off + len), at);
    const e = from.data[off + 1] as number;
    const stops = from.data[off + 3] as number;
    this.data[at + 1] = this.eases.length;
    for (let s = 0; s < stops; s++) this.eases.push(from.eases[e + s]);
    return at;
  }

  /**
   * Folds the row at `off` at `phase` into subject `slot`'s values at weight `w`: what `segment`
   * and the stock lerp and fold give for each track, read from this pool.
   */
  fold(off: number, phase: number, chans: readonly KeyChannel[], slot: number, w: number): void {
    const d = this.data;
    const duration = d[off + 2] as number;
    let e = d[off + 1] as number;
    let o = off + HEAD;
    const end = off + (d[off] as number);
    for (let i = 0; o < end; i++) {
      const ch = chans[i] as KeyChannel;
      const axes = ch.axes;
      const stride = 1 + axes;
      const n = d[o] as number;
      const ph = shift(d[o + 1] as number, phase, duration);
      const first = o + 2;
      o = first + n * stride;
      const k = locate(d, first, stride, n, ph);
      const stops = e;
      e += n;
      if (k === -2) continue;
      const values = ch.values;
      const base = slot * axes;
      if (k === -1 || k === n) {
        const at = first + (k === -1 ? 0 : n - 1) * stride + 1;
        for (let a = 0; a < axes; a++)
          values[base + a] = foldNumber(ch.op, values[base + a] as number, d[at + a] as number, w);
        continue;
      }
      const b = first + k * stride;
      const before = b - stride;
      const u = fraction(ph, d[before] as number, d[b] as number);
      const ease = this.eases[stops + k];
      const eased = ease ? ease(u) : u;
      for (let a = 0; a < axes; a++) {
        const v = lerpNumber(d[before + 1 + a] as number, d[b + 1 + a] as number, eased);
        values[base + a] = foldNumber(ch.op, values[base + a] as number, v, w);
      }
    }
  }

  private reserve(len: number): number {
    const at = this.used;
    if (at + len > this.data.length) {
      const data = new Float64Array(Math.max(at + len, this.data.length * 2));
      data.set(this.data.subarray(0, at));
      this.data = data;
    }
    this.used = at + len;
    return at;
  }
}

/** Whether a stop's value folds on a lane as numbers: a number on a number, an array on an array. */
function flat(value: unknown, ch: KeyChannel): boolean {
  if (ch.scalar) return typeof value === 'number';
  if (!(Array.isArray(value) || ArrayBuffer.isView(value))) return false;
  const arr = value as ArrayLike<unknown>;
  for (let a = 0; a < ch.axes; a++) {
    const x = arr[a];
    if (x !== undefined && typeof x !== 'number') return false;
  }
  return true;
}
