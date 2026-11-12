import { Store } from './store.js';

/** Past this many entries let go of at the front, the list is closed up, once they are half of it. */
const SLACK = 512;

/** Made where the mix now stands. */
const GIVEN = 0;
/** Taken off by a seek back, for the replay to make again. */
const AHEAD = 1;
/** Made again by a replay, or let go of. */
const SPENT = 2;

/** A `stagger` answer, or, with a NaN delay, the subject leaving the voice: faded out or dropped. */
interface Entry<I> {
  readonly subject: I;
  readonly at: number;
  readonly seq: number;
  readonly delay: number;
  state: typeof GIVEN | typeof AHEAD | typeof SPENT;
}

const isLeaving = (e: Entry<unknown>): boolean => Number.isNaN(e.delay);

/**
 * A voice's `stagger` answers under history, and when each subject left it, in the order made, so a
 * replay after a seek back gives each answer again where the live mix gave it rather than asking.
 * A seek back to frame `seq` takes every entry made after it off, ahead, for the replay to make
 * again in turn. An entry is let go once history no longer reaches the moment it was made: memory
 * follows the history window, not the voice's life.
 */
export class Staggers<I> {
  /** Every entry kept, in the order made; let go of from the front as history lets go of its moment. */
  private list: Entry<I>[] = [];
  private head = 0;
  /** By subject, the entries a replay has still to make, next first. */
  private ahead = new Store<I, Entry<I>[]>();
  /** By subject, its latest entry where the mix now stands. */
  private last = new Store<I, Entry<I>>();
  /** The frame the latest seek back went to; -Infinity before one. */
  private sought = Number.NEGATIVE_INFINITY;
  /** How many entries are kept, given or ahead. */
  size = 0;

  /**
   * The answer the voice gives as it meets `subject` afresh, taken: where a seek back could not put
   * back the record the subject had then, the one that record was made with; else the next a
   * replay has to give; undefined where it is to ask.
   */
  take(subject: I): number | undefined {
    const had = this.last.get(subject);
    if (had !== undefined && had.state === GIVEN && had.seq <= this.sought && !isLeaving(had))
      return had.delay;
    const queue = this.ahead.get(subject);
    if (queue === undefined) return undefined;
    let found: number | undefined;
    while (found === undefined && queue.length > 0) {
      const e = queue.shift() as Entry<I>;
      this.spend(e);
      if (!isLeaving(e)) found = e.delay;
    }
    if (queue.length === 0) this.ahead.delete(subject);
    return found;
  }

  /**
   * The answer a replay gives at its next meeting of `subject`, left for it; with `left`, at the
   * meeting after it next leaves. Undefined where it has none.
   */
  next(subject: I, left = false): number | undefined {
    const queue = this.ahead.get(subject);
    if (queue === undefined) return undefined;
    let past = !left;
    for (const e of queue)
      if (isLeaving(e)) past = true;
      else if (past) return e.delay;
    return undefined;
  }

  /** Keeps an answer given at mix time `at` in frame `seq`, letting go of those from before `reach`. */
  give(subject: I, at: number, seq: number, delay: number, reach: number): void {
    this.last.set(subject, this.push(subject, at, seq, delay, GIVEN, reach));
  }

  /**
   * Keeps that `subject` left the voice, where it had an answer to leave, so its next meeting asks
   * afresh. A replay's leaving makes the one ahead again, and with it any answer before it that a
   * record put back already holds.
   */
  leave(subject: I, at: number, seq: number, reach: number): void {
    const queue = this.ahead.get(subject);
    let again = false;
    if (queue?.some(isLeaving)) {
      again = true;
      for (;;) {
        const e = queue.shift() as Entry<I>;
        this.spend(e);
        if (isLeaving(e)) break;
      }
      if (queue.length === 0) this.ahead.delete(subject);
    }
    const had = this.last.get(subject);
    if (again || (had !== undefined && !isLeaving(had)))
      this.last.set(subject, this.push(subject, at, seq, Number.NaN, GIVEN, reach));
  }

  /** Keeps an answer for the next meeting of `subject` to take, as a replay's would be. */
  hold(subject: I, at: number, seq: number, delay: number, reach: number): void {
    const e = this.push(subject, at, seq, delay, AHEAD, reach);
    const queue = this.ahead.get(subject);
    if (queue === undefined) this.ahead.set(subject, [e]);
    else queue.push(e);
  }

  /** A seek back to the end of frame `seq`: every entry made after it is ahead, before those already. */
  back(seq: number): void {
    this.sought = seq;
    const list = this.list;
    let i = list.length - 1;
    while (i >= this.head && (list[i] as Entry<I>).seq > seq) i--;
    const moved = new Store<I, Entry<I>[]>();
    const touched: I[] = [];
    for (let j = i + 1; j < list.length; j++) {
      const e = list[j] as Entry<I>;
      if (e.state !== GIVEN) continue;
      e.state = AHEAD;
      const m = moved.get(e.subject);
      if (m !== undefined) m.push(e);
      else {
        moved.set(e.subject, [e]);
        touched.push(e.subject);
      }
    }
    for (const s of touched) {
      const m = moved.get(s) as Entry<I>[];
      const queue = this.ahead.get(s);
      this.ahead.set(s, queue === undefined ? m : m.concat(queue));
      this.last.delete(s);
    }
    // Each subject touched stands where its latest entry by the frame sought left it.
    let open = touched.length;
    for (let j = i; j >= this.head && open > 0; j--) {
      const e = list[j] as Entry<I>;
      if (e.state !== GIVEN || moved.get(e.subject) === undefined) continue;
      if (this.last.get(e.subject) !== undefined) continue;
      this.last.set(e.subject, e);
      open--;
    }
  }

  /** Marks an entry made again or let go of. */
  private spend(e: Entry<I>): void {
    if (e.state === SPENT) return;
    e.state = SPENT;
    this.size--;
  }

  private push(
    subject: I,
    at: number,
    seq: number,
    delay: number,
    state: Entry<I>['state'],
    reach: number,
  ): Entry<I> {
    this.shed(reach);
    const e: Entry<I> = { subject, at, seq, delay, state };
    this.list.push(e);
    this.size++;
    return e;
  }

  /** Lets go of every entry made at or before mix time `reach`, which no seek back reaches past. */
  private shed(reach: number): void {
    const list = this.list;
    let head = this.head;
    while (head < list.length && (list[head] as Entry<I>).at <= reach) {
      const e = list[head] as Entry<I>;
      head++;
      if (e.state === AHEAD) {
        const queue = this.ahead.get(e.subject) as Entry<I>[];
        queue.splice(queue.indexOf(e), 1);
        if (queue.length === 0) this.ahead.delete(e.subject);
      } else if (e.state === GIVEN && this.last.get(e.subject) === e) this.last.delete(e.subject);
      this.spend(e);
    }
    if (head >= SLACK && head * 2 >= list.length) {
      list.splice(0, head);
      head = 0;
    }
    this.head = head;
  }
}
