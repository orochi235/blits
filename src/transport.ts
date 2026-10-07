import type { Mixer } from './mixer.js';
import { move, nextFrame, waits } from './move.js';
import { Pace } from './pace.js';
import { pin } from './place.js';
import { record, replay, tapeOf } from './tape.js';
import type { MixOptions, Tape } from './types.js';

/**
 * A mark the host announced on a score: `at` in host time, so the rate never moves one, and NaN
 * until the next sync for one announced as now before any sync; `made` is the mix time it was
 * announced, for a read back to know what was known.
 */
export interface Announced {
  name: string;
  score: string | undefined;
  tags: readonly string[];
  at: number;
  made: number;
  order: number;
}

/**
 * The clock its mixes play on: host time less what `rebase` took out, at the rate its `pace`
 * sets, moved by `sync` and `seek`, and the tape of calls a seek plays again. A mix made alone
 * gets one holding only itself.
 */
export class Transport {
  readonly members: Mixer<unknown, unknown>[] = [];
  /** The mix clock at the last sync or seek. */
  now = Number.NaN;
  /** Host time at the last sync: the host's timestamp less every gap `rebase` took out. */
  u = Number.NaN;
  offset = 0;
  /** The mix time of the first sync. */
  born = Number.NaN;
  last = Number.NaN;
  rebasing = false;
  /** The rate; null while it has never been set, when mix time is host time. */
  pace: Pace | null = null;
  /** True while the tape makes a recorded call again, so it is not recorded twice. */
  replaying = false;
  announced: Announced[] = [];
  /** Numbers voices and announced marks across every member, in the order they were made. */
  nextId = 1;
  readonly tape: Tape | undefined;

  constructor(readonly history: MixOptions['history']) {
    this.tape = tapeOf(this);
  }

  /** Whether this is a projection's own transport, which records and seeks nothing. */
  get projecting(): boolean {
    return this.members.some((m) => m.projecting);
  }

  join(mix: Mixer<unknown, unknown>): void {
    this.members.push(mix);
  }

  sync(timestamp: number): void {
    const members = this.members;
    for (const m of members) m.syncing = true;
    try {
      this.syncAt(timestamp);
    } finally {
      for (const m of members) m.syncing = false;
    }
  }

  private syncAt(timestamp: number): void {
    if (timestamp < this.last && !this.rebasing)
      throw new RangeError(
        `blits: sync went back from ${this.last} to ${timestamp}; the host's clock only goes forward, and seek moves the mix`,
      );
    if (this.rebasing && !Number.isNaN(this.last)) this.offset += timestamp - this.last;
    this.rebasing = false;
    this.last = timestamp;
    const u = timestamp - this.offset;
    let pace = this.pace;
    let now = pace === null ? u : pace.sync(u);
    const later = u !== this.u;
    const still = later && now === this.now;
    this.u = u;
    if (Number.isNaN(this.born)) this.born = now;
    // Calls the host made before, played again where a seek went back past them; one may set the
    // rate, which moves where this sync lands.
    if (this.tape !== undefined && now > this.now) {
      const reading = () => (this.pace === null ? u : this.pace.reading(u));
      replay(this, reading);
      pace = this.pace;
      now = reading();
    }
    // Host time moving while the mix clock stands still lands what waits on host time or the host.
    const moved = now !== this.now;
    for (const m of this.members)
      if (moved || (later && pace !== null && waits(m))) move(m, now);
    const history = this.history;
    if (this.tape !== undefined && history !== undefined) this.tape.prune(now - history.ms);
    // It is a frame too, which asks every weight signal again, so one reading input follows it.
    if (still)
      for (const m of this.members) {
        m.frame = nextFrame();
        m.lanes?.refill();
      }
    for (const m of this.members) {
      const bookers = m.bookers;
      if (bookers !== null) for (const b of bookers) b.sync();
    }
  }

  rebase(): void {
    this.rebasing = true;
  }

  get rate(): number {
    return this.pace === null ? 1 : this.pace.rateAt(this.u);
  }

  set rate(r: number) {
    this.ramp(r, 0);
  }

  ramp(rate: number, over: number): void {
    if (!(rate >= 0 && rate < Number.POSITIVE_INFINITY))
      throw new RangeError(`blits: a mix's rate is a finite number, 0 or more, not ${rate}`);
    if (this.pace === null) {
      this.pace = new Pace(this.history !== undefined);
      // Until now mix time was host time, so a pending voice's start is the host time it was given.
      for (const m of this.members)
        for (const v of m.cued)
          if (v.state === 'pending' && !v.placing && v.owner === null && v.spec.start !== undefined)
            pin(m, v, v.start);
    }
    const history = this.history;
    const reach = history === undefined ? Number.NEGATIVE_INFINITY : this.now - history.ms;
    this.pace.change(this.u, rate, over, reach);
    for (const m of this.members) m.stir();
    record(this, 'rate', () => this.ramp(rate, over));
  }
}
