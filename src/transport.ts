import { listedAll } from './marks.js';
import type { Mixer } from './mixer.js';
import { move, nextFrame, waits } from './move.js';
import { Pace } from './pace.js';
import { pin } from './place.js';
import { projectAll } from './project.js';
import { seek } from './seek.js';
import { record, replay, tapeOf } from './tape.js';
import type {
  Marked,
  Mix,
  MixOptions,
  Tape,
  Transport as TransportApi,
  TransportOptions,
  TransportProjection,
} from './types.js';

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
  /** The slot of the mix that announced it, -1 for the transport; only it sees an unnamed score. */
  slot: number;
  /** That mix's name, for `Marked.mix`. */
  mix: string | undefined;
}

type Member = Mixer<unknown, unknown>;

/**
 * The clock its mixes play on: host time less what `rebase` took out, at the rate its `pace`
 * sets, moved by `sync` and `seek`, and the tape of calls a seek plays again. A mix made alone
 * gets one holding only itself.
 */
export class Transport implements TransportApi {
  /** The mixes on it, in the order they joined. */
  members: Member[] = [];
  /** Under history, mixes dropped while a seek back may still reach them, by when. */
  dropped: { mix: Member; at: number }[] = [];
  /** Numbers the mixes as they join, for their order and for whose unnamed score a mark is on. */
  slots = 0;
  private wakeFns: (() => void)[] = [];
  /** Whether it has woken since the last sync, so it wakes once. */
  private woken = false;
  /** The mix clock at the last sync or seek. */
  now = Number.NaN;
  /** Host time at the last sync: the host's timestamp less every gap `rebase` took out. */
  u = Number.NaN;
  offset = 0;
  /** The mix time of the first sync. */
  born = Number.NaN;
  /** The earliest mix time what history keeps in memory restores exactly. */
  floor = Number.NEGATIVE_INFINITY;
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

  /**
   * `shared` for one the host made, whose mixes may not move it themselves; a mix made alone makes
   * one that is not.
   */
  constructor(
    readonly history: MixOptions['history'],
    readonly shared: boolean,
  ) {
    this.tape = tapeOf(this);
  }

  /** Whether this is a projection's own transport, which records and seeks nothing. */
  get projecting(): boolean {
    return this.members.some((m) => m.projecting);
  }

  /** Takes a mix on, after every mix that joined before it; `slot` keeps a copy's in place. */
  join(mix: Member, slot = this.slots++): void {
    mix.slot = slot;
    const i = this.members.findIndex((m) => m.slot > slot);
    if (i < 0) this.members.push(mix);
    else this.members.splice(i, 0, mix);
  }

  drop<I, O, H>(mix: Mix<I, O, H>): void {
    const m = mix as unknown as Member;
    const i = this.members.indexOf(m);
    if (i < 0) throw new Error(`blits: ${m.name ?? 'that mix'} is not on this transport`);
    this.members.splice(i, 1);
    m.dropped = true;
    if (this.history !== undefined) {
      this.dropped.push({ mix: m, at: this.now });
      record(this, 'drop', () => this.drop(mix));
    }
  }

  /** A seek back to `t`: every mix dropped after it is back on, as it stood then. */
  undrop(t: number): void {
    const back = this.dropped.filter((d) => d.at > t);
    if (back.length === 0) return;
    this.dropped = this.dropped.filter((d) => d.at <= t);
    for (const d of back) {
      d.mix.dropped = false;
      this.join(d.mix, d.mix.slot);
    }
  }

  seek(time: number): void {
    seek(this, time);
  }

  announce(name: string, opts: { at?: number; score: string; tags?: readonly string[] }): void {
    if (opts?.score === undefined)
      throw new Error('blits: a transport announces on a named score, which every mix on it sees');
    announce(this, name, opts, -1, undefined);
  }

  marks(from: number, to: number): Marked[] {
    return listedAll(this, from, to).map(({ order: _, ...m }) => m);
  }

  project(time: number): TransportProjection {
    return projectAll(this, time);
  }

  get live(): boolean {
    return this.members.some((m) => m.live);
  }

  get inert(): boolean {
    return this.members.every((m) => m.inert);
  }

  onWake(fn: () => void): () => void {
    const fns = this.wakeFns;
    fns.push(fn);
    return () => {
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    };
  }

  /** A mix on it was changed outside a sync: wakes whoever sleeps on the transport, once. */
  woke(): void {
    if (this.woken) return;
    this.woken = true;
    for (const fn of [...this.wakeFns]) fn();
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
    for (const m of this.members) if (moved || (later && pace !== null && waits(m))) move(m, now);
    const history = this.history;
    this.kept();
    if (this.tape !== undefined && history !== undefined) this.tape.prune(now - history.ms);
    if (history !== undefined && this.dropped.length > 0)
      this.dropped = this.dropped.filter((d) => d.at >= now - history.ms);
    this.woken = false;
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

  /** Moves `floor` past what the mix clock standing at `now` has let go of. */
  kept(): void {
    const history = this.history;
    if (history !== undefined && this.now - history.ms > this.floor)
      this.floor = this.now - history.ms;
  }

  /** Whether history reaches back to mix time `t`, from memory. */
  reaches(t: number): boolean {
    return t >= this.floor && t >= this.now - (this.history?.ms ?? 0);
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

/** Puts a mark on a score: one the transport announced, or a mix on it, `slot`. */
export function announce(
  transport: Transport,
  name: string,
  opts: { at?: number; score?: string; tags?: readonly string[] },
  slot: number,
  mix: string | undefined,
): void {
  const at = opts.at !== undefined ? opts.at - transport.offset : transport.u;
  const mark: Announced = {
    name,
    score: opts.score,
    tags: opts.tags ?? [],
    at,
    made: Number.isNaN(transport.now) ? Number.NEGATIVE_INFINITY : transport.now,
    order: transport.nextId++,
    slot,
    mix,
  };
  transport.announced.push(mark);
  record(transport, 'announce', () => {
    transport.announced.push({ ...mark });
  });
}

/**
 * Makes a transport several mixes can share, each made with `transport` in its options.
 *
 * @category mix
 */
export function transport(opts: TransportOptions = {}): TransportApi {
  return new Transport(opts.history, true);
}
