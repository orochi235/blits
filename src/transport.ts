import { listedAll } from './marks.js';
import type { Mixer } from './mixer.js';
import { move, nextFrame, waits } from './move.js';
import { Pace } from './pace.js';
import { Pager, pageTransport, prepare } from './paging.js';
import { pin } from './place.js';
import { projectAll } from './project.js';
import { type ScoreHolders, scoredDrop, scoredJoin } from './scored.js';
import { seek } from './seek.js';
import { record, replay, tapeOf } from './tape.js';

/** How far the tape's reach moves before it is pruned again, ms of mix time. */
const TAPE_STEP_MS = 1000;

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
 * until the next sync for one announced as now before any sync.
 */
export interface Announced {
  name: string;
  score: string | undefined;
  tags: readonly string[];
  at: number;
  order: number;
  /** The frame it was announced in, for a read back to know what was known. */
  seq: number;
  /** The slot of the mix that announced it, -1 for the transport; only it sees an unnamed score. */
  slot: number;
  /** That mix's name, for `Marked.mix`. */
  mix: string | undefined;
}

type Member = Mixer<unknown, unknown>;

/**
 * One frame on the transport: its number, the mix time it stood at and the host time it was made
 * at. Rate 0 holds mix time still across frames, so only the number tells two of them apart.
 */
export interface Frame {
  seq: number;
  at: number;
  u: number;
}

/** Where history is cut for a seek or read: what frame `seq` made, and before it, is kept. */
export interface Cut {
  seq: number;
  /** For a read of what a frame showed: of that frame's own changes, only those made before it was read. */
  strict: boolean;
}

/** Whether a change made in frame `seq` falls inside `cut`; `early` for one made before the frame was read. */
export function within(cut: Cut, seq: number, early = false): boolean {
  return seq < cut.seq || (seq === cut.seq && (!cut.strict || early));
}

/**
 * The clock its mixes play on: host time less what `rebase` took out, at the rate its `pace`
 * sets, moved by `sync` and `seek`, and the tape of calls a seek plays again. A mix made alone
 * gets one holding only itself.
 */
export class Transport implements TransportApi {
  /** The mixes on it, in the order they joined. */
  members: Member[] = [];
  /** Under history, mixes dropped while a seek back may still reach them, by when. */
  dropped: { mix: Member; at: number; seq: number }[] = [];
  /** Numbers the mixes as they join, for their order and for whose unnamed score a mark is on. */
  slots = 0;
  holders: ScoreHolders = new Map();
  private wakeFns: (() => void)[] = [];
  /** Whether it has woken since the last sync, so it wakes once. */
  private woken = false;
  /** The mix clock at the last sync or seek. */
  now = Number.NaN;
  /**
   * The number of the frame being played: each sync and seek begins one, and so does each host
   * time the tape plays calls again at.
   */
  seq = 0;
  /** Under history, the frames a seek or read back may reach, oldest first. */
  frames: Frame[] = [];
  /** Host time at the last sync: the host's timestamp less every gap `rebase` took out. */
  u = Number.NaN;
  offset = 0;
  /** The mix time of the first sync. */
  born = Number.NaN;
  /** The earliest mix time what history keeps in memory restores exactly. */
  floor = Number.NEGATIVE_INFINITY;
  last = Number.NaN;
  rebasing = false;
  /** The reach the tape was last pruned to. */
  taped = Number.NEGATIVE_INFINITY;
  /** The rate; null while it has never been set, when mix time is host time. */
  pace: Pace | null = null;
  /** The latest mix time a voice any mix on it let go of from `gone` had left at. */
  forgotTo = Number.NEGATIVE_INFINITY;
  /**
   * The latest mix time a host changed a mix on it, or a voice or a subject left one: without
   * history, the earliest time a read back still finds the mixes as they stand now.
   */
  settled = Number.NEGATIVE_INFINITY;

  /** Records a change or a leaving at the mix time now; before the first sync, nothing. */
  settle(): void {
    if (this.now > this.settled) this.settled = this.now;
  }
  /** The frame the rate was first set in, which a seek or read back to before it finds unset. */
  pacedSeq = Number.POSITIVE_INFINITY;
  /** True while the tape makes a recorded call again, so it is not recorded twice. */
  replaying = false;
  announced: Announced[] = [];
  /** Numbers voices and announced marks across every member, in the order they were made. */
  nextId = 1;
  readonly tape: Tape | undefined;
  /** With a history store, what left memory for it; null without one. */
  readonly pager: Pager | null;

  /**
   * `shared` for one the host made, whose mixes may not move it themselves; a mix made alone makes
   * one that is not.
   */
  constructor(
    readonly history: MixOptions['history'],
    readonly shared: boolean,
  ) {
    this.tape = tapeOf(this);
    this.pager = history?.store === undefined ? null : new Pager(history.store);
  }

  /** Whether this is a projection's own transport, which records and seeks nothing. */
  get projecting(): boolean {
    return this.members.some((m) => m.projecting);
  }

  /** Takes a mix on, after every mix that joined before it; `slot` keeps one a seek puts back in place. */
  join(mix: Member, slot = this.slots++): void {
    mix.slot = slot;
    const i = this.members.findIndex((m) => m.slot > slot);
    if (i < 0) this.members.push(mix);
    else this.members.splice(i, 0, mix);
    scoredJoin(mix);
  }

  drop<I, O, H>(mix: Mix<I, O, H>): void {
    const m = mix as unknown as Member;
    const i = this.members.indexOf(m);
    if (i < 0) throw new Error(`blits: ${m.name ?? 'that mix'} is not on this transport`);
    this.members.splice(i, 1);
    scoredDrop(m);
    m.dropped = true;
    if (this.history !== undefined) {
      this.dropped.push({ mix: m, at: this.now, seq: this.seq });
      record(this, 'drop', () => this.drop(mix));
    }
  }

  /** A seek back to frame `seq`: every mix dropped after it is back on, as it stood then. */
  undrop(seq: number): void {
    const back = this.dropped.filter((d) => d.seq > seq);
    if (back.length === 0) return;
    this.dropped = this.dropped.filter((d) => d.seq <= seq);
    for (const d of back) {
      d.mix.dropped = false;
      this.join(d.mix, d.mix.slot);
    }
  }

  seek(time: number): void {
    seek(this, time);
  }

  prepare(time: number): Promise<void> {
    return prepare(this, time);
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
    if (Number.isNaN(timestamp))
      throw new RangeError('blits: sync was given NaN; it takes the host clock as a number');
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
    // A call played again at this sync's own host time began its frame, moved there before it.
    let begun = false;
    if (this.tape !== undefined && later) {
      begun = replay(this, (at) => at <= u) === u;
      pace = this.pace;
      now = pace === null ? u : pace.reading(u);
    }
    if (!begun) {
      this.tick(now);
      // Host time moving while the mix clock stands still lands what waits on host time or the host.
      const moved = now !== this.now;
      for (const m of this.members) if (moved || (later && pace !== null && waits(m))) move(m, now);
    }
    const history = this.history;
    this.kept();
    const reach = this.keepsFrom();
    // In steps: the tape shifts every entry it keeps to let go of the oldest, and one a second
    // behind reach is never played again.
    if (this.tape !== undefined && history !== undefined && !(reach - this.taped < TAPE_STEP_MS)) {
      this.tape.prune(reach);
      this.taped = reach;
    }
    if (history !== undefined && this.dropped.length > 0)
      this.dropped = this.dropped.filter((d) => d.at >= reach);
    const frames = this.frames;
    let n = 0;
    while (n + 1 < frames.length && (frames[n + 1] as Frame).at <= reach) n++;
    if (n > 0) frames.splice(0, n);
    pageTransport(this);
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

  /** Begins a frame at mix time `at` and the host time the transport stands at. */
  tick(at: number): void {
    const seq = ++this.seq;
    if (this.history !== undefined) this.frames.push({ seq, at, u: this.u });
    for (const m of this.members) m.looked = false;
  }

  /**
   * The frame a seek or read to mix time `t` lands on: the last one standing at or before `t`,
   * since rate 0 can hold the clock at `t` for many.
   */
  frameAt(t: number): Frame | undefined {
    const frames = this.frames;
    let lo = 0;
    let hi = frames.length - 1;
    let found: Frame | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = frames[mid] as Frame;
      if (f.at <= t) {
        found = f;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  rebase(): void {
    this.rebasing = true;
    this.settle();
  }

  /**
   * Moves `floor` past what the mix clock standing at `now` has let go of. With a store nothing is
   * let go: what leaves memory is paged, which moves it.
   */
  kept(): void {
    const history = this.history;
    if (history !== undefined && this.pager === null && this.now - history.ms > this.floor)
      this.floor = this.now - history.ms;
  }

  /** Whether history reaches back to mix time `t`, from memory. */
  reaches(t: number): boolean {
    if (this.pager !== null) return t >= this.floor;
    return t >= this.floor && t >= this.now - (this.history?.ms ?? 0);
  }

  /**
   * The earliest mix time it keeps what no store pages, the tape, dropped mixes, rate changes and
   * announced marks among them: with a store, all of it, since the host bounds the tape.
   */
  keepsFrom(): number {
    const history = this.history;
    if (history === undefined) return Number.POSITIVE_INFINITY;
    return this.pager === null ? this.now - history.ms : Number.NEGATIVE_INFINITY;
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
      this.pacedSeq = this.seq;
      // Until now mix time was host time, so a pending voice's start is the host time it was given.
      for (const m of this.members)
        for (const v of m.cued)
          if (v.state === 'pending' && !v.placing && v.owner === null && v.spec.start !== undefined)
            pin(m, v, v.start);
    }
    const reach = this.history === undefined ? Number.NEGATIVE_INFINITY : this.keepsFrom();
    this.pace.change(this.u, rate, over, reach, this.seq);
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
    order: transport.nextId++,
    seq: transport.seq,
    slot,
    mix,
  };
  transport.announced.push(mark);
  transport.settle();
  record(transport, 'announce', () => {
    transport.announced.push({ ...mark, seq: transport.seq });
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
