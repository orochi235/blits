import type { Frame } from './transport.js';

/** Past this many frames let go of at the front, the list is closed up, once they are half of it. */
const SLACK = 512;

/**
 * The frames a transport's history can still reach, oldest first. A frame leaves the front on
 * most syncs, so the front is an index that moves and the array closes up only now and then.
 */
export class Frames {
  private list: Frame[] = [];
  private head = 0;

  get length(): number {
    return this.list.length - this.head;
  }

  push(frame: Frame): void {
    this.list.push(frame);
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
    const list = this.list;
    let lo = this.head;
    let hi = list.length - 1;
    let found: Frame | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = list[mid] as Frame;
      if (f.at <= t) {
        found = f;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  /** Every frame held, oldest first. */
  all(): Frame[] {
    return this.list.slice(this.head);
  }

  set(frames: Frame[]): void {
    this.list = frames;
    this.head = 0;
  }
}
