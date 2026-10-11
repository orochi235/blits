import type { BookedHit, Booker, Marked, Sent } from '@msb235/blits';
import type { Built } from './compile';
import type { Subject } from './stage';

/** How far ahead of the host clock the playground books, ms. */
export const AHEAD = 100;
/** The most entries each list keeps; the oldest go first. */
export const MAX_EVENTS = 200;

/** One item `mix.book` handed over: when on the host clock, how late, and whether it was taken back. */
export interface Booked {
  item: Marked | BookedHit;
  when: number;
  lateBy: number;
  canceled: boolean;
}

const push = <T>(list: T[], item: T) => {
  list.push(item);
  if (list.length > MAX_EVENTS) list.shift();
};

/**
 * What the full mix reports as it plays: every mark and hit `mix.book` hands over, and every event
 * `mix.drain` returns. A solo mix is drained too, and what it sent thrown away.
 */
export class EventLog {
  /** Only the voices carrying this tag are booked and drained; undefined for all. */
  tag: string | undefined;
  booked: Booked[] = [];
  sent: Sent<Subject>[] = [];
  private booker: Booker | null = null;

  /** Starts over on a new build, booking against `clock`, the host's. */
  attach(built: Built, clock: () => number): void {
    this.booker?.cancel();
    this.booked = [];
    this.sent = [];
    this.booker = built.mix.book({
      clock,
      ahead: AHEAD,
      late: Number.POSITIVE_INFINITY,
      ...(this.tag ? { tag: this.tag } : {}),
      take: (item, when, lateBy) => {
        const entry: Booked = { item, when, lateBy, canceled: false };
        push(this.booked, entry);
        return {
          cancel: () => {
            entry.canceled = true;
          },
        };
      },
    });
  }

  /** Takes what was sent since the last frame; call after probing. */
  drain(built: Built): void {
    for (const e of built.mix.drain(this.tag)) push(this.sent, e);
    if (this.tag) built.mix.drain();
    for (const solo of built.solos.values()) solo.drain();
  }

  /** Forgets what was sent after mix time `t`, for a seek back to it. */
  cut(t: number): void {
    this.sent = this.sent.filter((e) => e.timestamp <= t);
  }
}
