import type { BookedHit, Booker, BookOptions, Hit, Marked } from './types.js';
import type { Voice } from './voice.js';

/** A clock read further than this from the offset's prediction is a jump, not jitter. */
const RESYNC_MS = 50;
/** The share of each frame's residual folded into the offset. */
const SLEW = 0.05;
/** A booking whose time moves by more than this is stopped and taken again. */
const RETIME_MS = 1;

const none: readonly string[] = [];

/** A mark as the mix lists it, with what tells it apart from every other for good. */
export type Listed = Marked & { order: number };

/** What a booker reads of the mix that made it. */
export interface BookHost<I, O> {
  /** The voices in the mix, pending, live, frozen or fading. */
  readonly voices: readonly Voice<I, O>[];
  /** The host's timestamp at the last sync. */
  readonly timestamp: number;
  /** The mix clock at the last sync. */
  readonly now: number;
  /** The host timestamp the mix clock reads mix time `t` at; Infinity where it never will. */
  hostOf(t: number): number;
  /** What the mix clock reads at host timestamp `timestamp`. */
  readingAt(timestamp: number): number;
  /** Mix time a voice is gone at, where something has fixed it. */
  endOf(voice: Voice<I, O>): number | undefined;
  marks(from: number, to: number): Listed[];
  /** The booker stopped: forget it. */
  unhook(booker: Book<I, O>): void;
}

/** Refuses hits a voice could never play. */
export function checkHits(hits: readonly Hit[], duration: number): void {
  for (const h of hits)
    if (!(h.at >= 0) || (duration > 0 ? !(h.at < duration) : !Number.isFinite(h.at)))
      throw new RangeError(
        duration > 0
          ? `blits: a hit's at is voice ms into a pass, 0 up to ${duration}, not ${h.at}`
          : `blits: a hit's at is voice ms, 0 or more, not ${h.at}`,
      );
}

interface Booking {
  /** Host time it was booked for. */
  time: number;
  /** Outside-clock time it was booked for, before holding it to the clock's now. */
  at: number;
  taken: { stop(): void } | undefined;
}

/** A voice with hits, as one booker follows it. */
interface Track {
  /** Voice ms scanned up to, so a hit behind it is not taken again. */
  seenTo: number;
  /** The voice's `jumps` when last looked at. */
  jumps: number;
  /** Bookings by pass and index, while still ahead or come due this sync. */
  booked: Map<number, Booking>;
  /** The sync it was last seen at, so one whose voice left is let go. */
  met: number;
}

interface Due {
  time: number;
  item: Marked | BookedHit;
  into: Map<number, Booking>;
  key: number;
}

/** One `book` call: maps host time onto the outside clock and takes each item once. */
export class Book<I, O> implements Booker {
  /** The outside clock at the last sync, smoothed; NaN until the first. */
  private est = Number.NaN;
  private last = Number.NaN;
  /** The mix clock at the previous sync, where a voice's clock change counts from. */
  private prev = Number.NaN;
  private round = 0;
  private stopped = false;
  /** The host time the mix last sought at: a mark at or before it was taken before the seek. */
  private floor = Number.NEGATIVE_INFINITY;
  /** Bookings of marks, by `keyOf`, kept while listed so one already taken is not taken late. */
  private readonly marked = new Map<number, Booking>();
  private readonly tracks = new Map<Voice<I, O>, Track>();
  private readonly due: Due[] = [];

  constructor(
    private readonly host: BookHost<I, O>,
    private readonly opts: BookOptions,
  ) {}

  /** Books what comes within `ahead` of this sync, and retracts what moved. */
  sync(): void {
    if (this.stopped) return;
    const host = this.host;
    const now = host.timestamp;
    const c = this.opts.clock();
    if (Number.isNaN(this.est)) this.est = c;
    else {
      const est = this.est + (now - this.last);
      const residual = c - est;
      this.est = Math.abs(residual) > RESYNC_MS ? c : est + residual * SLEW;
    }
    this.last = now;
    const prev = Number.isNaN(this.prev) ? host.now : this.prev;
    this.prev = host.now;
    this.round++;

    this.marks(now);
    this.hits(now, prev);

    const due = this.due;
    due.sort((a, b) => a.time - b.time);
    const late = this.opts.late;
    for (const d of due) {
      const lateBy = d.time < now ? now - d.time : 0;
      if (lateBy > late) continue;
      const at = this.est + (d.time - now);
      const booking: Booking = { time: d.time, at, taken: undefined };
      d.into.set(d.key, booking);
      booking.taken = this.opts.take(d.item, lateBy > 0 ? c : Math.max(at, c), lateBy);
    }
    due.length = 0;
    for (const t of this.tracks.values())
      for (const [k, b] of t.booked) if (b.time <= now) t.booked.delete(k);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const b of this.marked.values()) if (b.time > this.last) b.taken?.stop();
    for (const t of this.tracks.values())
      for (const b of t.booked.values()) if (b.time > this.last) b.taken?.stop();
    this.marked.clear();
    this.tracks.clear();
    this.host.unhook(this);
  }

  /**
   * The mix was sought to `host.now`, back or ahead: what is booked ahead is stopped, and
   * everything after that moment is booked as the mix reaches it.
   */
  sought(): void {
    if (this.stopped) return;
    const last = this.last;
    for (const b of this.marked.values()) if (b.time > last) b.taken?.stop();
    for (const t of this.tracks.values())
      for (const b of t.booked.values()) if (b.time > last) b.taken?.stop();
    this.marked.clear();
    this.tracks.clear();
    const host = this.host;
    this.floor = host.timestamp;
    this.prev = host.now;
    for (const voice of host.voices)
      if (voice.spec.hits !== undefined && voice.state !== 'done')
        this.tracks.set(voice, {
          seenTo: voice.elapsedAt(host.now),
          jumps: voice.jumps,
          booked: new Map(),
          met: this.round,
        });
  }

  /** Whether a standing booking now falls at host time `time` within `RETIME_MS`. */
  private stands(b: Booking, time: number | undefined): boolean {
    if (time === undefined || !Number.isFinite(time)) return false;
    return Math.abs(this.est + (time - this.last) - b.at) <= RETIME_MS;
  }

  private fits(score: string | undefined, tags: readonly string[]): boolean {
    const { tag, score: wants } = this.opts;
    return (wants === undefined || score === wants) && (tag === undefined || tags.includes(tag));
  }

  private marks(now: number): void {
    const listed = this.host.marks(now - this.opts.late, now + this.opts.ahead);
    const marked = this.marked;
    const seen = new Set<number>();
    for (const m of listed) {
      if (!this.fits(m.score, m.tags) || m.timestamp <= this.floor) continue;
      const key = keyOf(m);
      seen.add(key);
      const b = marked.get(key);
      if (b !== undefined) {
        if (b.time <= now || this.stands(b, m.timestamp)) continue;
        b.taken?.stop();
        marked.delete(key);
      }
      const { order: _, ...item } = m;
      this.due.push({ time: m.timestamp, item, into: marked, key });
    }
    for (const [key, b] of marked)
      if (!seen.has(key)) {
        if (b.time > now) b.taken?.stop();
        marked.delete(key);
      }
  }

  private hits(now: number, prev: number): void {
    const host = this.host;
    const round = this.round;
    const { ahead, late } = this.opts;
    const hiAt = host.readingAt(now + ahead);
    const loAt = Number.isFinite(late) ? host.readingAt(now - late) : Number.NEGATIVE_INFINITY;
    for (const voice of host.voices) {
      const hits = voice.spec.hits;
      if (hits === undefined || hits.length === 0 || voice.state === 'done') continue;
      if (!this.fits(voice.spec.score, voice.spec.tags ?? none)) continue;
      let t = this.tracks.get(voice);
      if (t === undefined) {
        t = { seenTo: Number.NEGATIVE_INFINITY, jumps: voice.jumps, booked: new Map(), met: round };
        this.tracks.set(voice, t);
      }
      t.met = round;
      // A seek counts from where it put the clock: what it jumped over is not late.
      if (t.jumps !== voice.jumps) {
        t.jumps = voice.jumps;
        t.seenTo = voice.elapsedAt(prev);
      }
      const end = host.endOf(voice);
      const n = hits.length;
      let moved = false;
      for (const [key, b] of t.booked) {
        if (b.time <= now) continue;
        const time = this.timeOfHit(voice, hits, Math.floor(key / n), key % n, end);
        if (this.stands(b, time)) continue;
        b.taken?.stop();
        t.booked.delete(key);
        moved = true;
      }
      // What moved is looked for again from the last sync on, so one now past is taken late.
      if (moved) t.seenTo = Math.min(t.seenTo, voice.elapsedAt(prev));
      const hi = voice.elapsedAt(hiAt);
      if (!(hi > t.seenTo)) continue;
      const lo = Math.max(t.seenTo, voice.elapsedAt(loAt));
      const d = voice.duration;
      const last = d > 0 ? Math.min(voice.passes - 1, Math.floor(hi / d)) : 0;
      for (let pass = d > 0 ? Math.max(0, Math.floor(lo / d)) : 0; pass <= last; pass++) {
        for (let i = 0; i < n; i++) {
          const e = pass * d + (hits[i] as Hit).at;
          if (!(e > t.seenTo && e <= hi)) continue;
          const key = pass * n + i;
          if (t.booked.has(key)) continue;
          const time = this.timeOfHit(voice, hits, pass, i, end);
          if (time === undefined || !Number.isFinite(time)) continue;
          const item: BookedHit = {
            timestamp: time,
            voice: voice.id,
            hit: i,
            pass,
            event: (hits[i] as Hit).event,
            score: voice.spec.score,
            name: voice.spec.name,
            tags: voice.spec.tags ?? none,
          };
          this.due.push({ time, item, into: t.booked, key });
        }
      }
      t.seenTo = hi;
    }
    for (const [voice, t] of this.tracks) {
      if (t.met === round) continue;
      for (const b of t.booked.values()) if (b.time > now) b.taken?.stop();
      this.tracks.delete(voice);
    }
  }

  /** Host time of a hit's pass, or undefined where the voice no longer plays it. */
  private timeOfHit(
    voice: Voice<I, O>,
    hits: readonly Hit[],
    pass: number,
    i: number,
    end: number | undefined,
  ): number | undefined {
    if (voice.state === 'done' || pass >= voice.passes) return undefined;
    const t = voice.timeAt(pass * voice.duration + (hits[i] as Hit).at);
    if (!Number.isFinite(t) || (end !== undefined && t >= end)) return undefined;
    return this.host.hostOf(t);
  }
}

const markIndex = { start: 1, in: 2, coast: 3, out: 4, end: 5 } as const;

/** A mark's identity: its voice and which of its marks, or the announcement. */
function keyOf(m: Listed): number {
  return m.order * 6 + (m.mark === undefined ? 0 : markIndex[m.mark]);
}
