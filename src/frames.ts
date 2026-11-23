import { lastIndex } from './sorted.js';
import type { Frame } from './transport.js';

/** Past this many frames let go of at the front, the list is closed up, once they are half of it. */
const SLACK = 512;
/** Frames held at one mix time are let go this many at a time, so most pushes move nothing. */
const HELD_SLACK = 32;

/**
 * The frames a transport's history can still reach, oldest first. A frame leaves the front on
 * most syncs, so the front is an index that moves and the array closes up only now and then.
 */
export class Frames {
  private list: Frame[] = [];
  private head = 0;
  /** Where the frames at the newest mix time begin. */
  private run = 0;

  get length(): number {
    return this.list.length - this.head;
  }

  /** The oldest frame still held. */
  get first(): Frame | undefined {
    return this.list[this.head];
  }

  /**
   * Adds the newest frame. While the clock stands at one mix time, as rate 0 holds it, the frames
   * there older than `heldMs` of host time are let go: history lets go by mix time, which stands
   * still, so they would otherwise pile up for as long as it does.
   */
  push(frame: Frame, heldMs = Number.POSITIVE_INFINITY): void {
    const list = this.list;
    const last = list[list.length - 1];
    list.push(frame);
    if (last === undefined || last.at !== frame.at) {
      this.run = list.length - 1;
      return;
    }
    const from = Math.max(this.run, this.head);
    let end = from;
    while (end < list.length - 1 && (list[end] as Frame).u < frame.u - heldMs) end++;
    if (end - from >= HELD_SLACK) list.splice(from, end - from);
  }

  /** Lets go of every frame before the last one at or before `reach`, giving each to `each`. */
  shed(reach: number, each?: (frame: Frame) => void): void {
    const list = this.list;
    let head = this.head;
    while (head + 1 < list.length && (list[head + 1] as Frame).at <= reach) {
      each?.(list[head] as Frame);
      head++;
    }
    if (head >= SLACK && head * 2 >= list.length) {
      list.splice(0, head);
      head = 0;
    }
    this.head = head;
  }

  /**
   * The frame a seek or read to mix time `t` lands on: the last one standing at or before `t`,
   * since rate 0 can hold the clock at `t` for many.
   */
  at(t: number): Frame | undefined {
    return this.list[lastIndex(this.list, t, true, this.head)];
  }

  /** The frame numbered `seq`, if it is still held. */
  numbered(seq: number): Frame | undefined {
    const list = this.list;
    let lo = this.head;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = list[mid] as Frame;
      if (f.seq === seq) return f;
      if (f.seq < seq) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** Every frame held, oldest first. */
  all(): Frame[] {
    return this.list.slice(this.head);
  }

  set(frames: Frame[]): void {
    this.list = frames;
    this.head = 0;
    const at = frames[frames.length - 1]?.at;
    let run = frames.length - 1;
    while (run > 0 && (frames[run - 1] as Frame).at === at) run--;
    this.run = Math.max(run, 0);
  }
}
