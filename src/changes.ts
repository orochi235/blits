import type { Motions } from './motions.js';
import { absent } from './numbers.js';
import { reading } from './reading.js';
import { type Change, numbers, RunFlag, type Segment } from './stretch.js';

const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;

/** Where `applied` reads a stretch at the time a change lands; copied out before it returns. */
let landing = { x: new Float64Array(4), v: new Float64Array(4) };

/**
 * Queues a retarget, set or push, untimed at the latest frame, for `subject`'s next read past its time.
 * The queue keeps the changes with a time in time order, ahead of any still waiting for one.
 */
export function change<I>(this: Motions<I>, subject: I, c: Change): void {
  const back = this.owner === null ? Number.NaN : this.owner.revive(this.ownerId, subject);
  const s = this.slot(subject);
  this.check(c.to, this.n);
  this.check(c.x, this.n);
  this.check(c.v, this.n);
  c.made = this.owner === null ? Number.NaN : this.owner.now();
  c.seq = this.owner === null ? Number.NaN : this.owner.seq();
  c.early = this.owner?.early() === true;
  if (c.at === undefined) {
    const at = this.frame(subject);
    if (!Number.isNaN(at)) c.at = at;
    else if (!Number.isNaN(back)) c.at = back;
  }
  const list = this.pending?.[s];
  if (list === undefined) {
    if (this.pending === null) this.pending = [undefined];
    this.pending[s] = [c];
    this.flag(s, PENDING, true);
  } else if (c.at === undefined) list.push(c);
  else this.queue(list, c, c.at);
  reading.moved++;
  const made: Change = { at: c.at, to: c.to, x: c.x, v: c.v };
  this.owner?.changed(this.ownerId, this, subject, made);
}

/** Files a change with a time after every one due by then, ahead of those still waiting for one. */
export function queue<I>(this: Motions<I>, list: Change[], c: Change, at: number): void {
  let i = list.length;
  while (i > 0) {
    const before = (list[i - 1] as Change).at;
    if (before !== undefined && before <= at) break;
    i--;
  }
  list.splice(i, 0, c);
}

/** Every change due by `t` applied to a copy of the stretch playing then, committing nothing. */
export function peek<I>(
  this: Motions<I>,
  s: number,
  t: number,
  xo: Float64Array,
  vo: Float64Array,
): void {
  let seg = this.playing(s, t);
  const list = this.dueTo(s);
  if (list !== undefined)
    for (const change of list) {
      const a = change.at;
      if (a === undefined || !(a <= t)) break;
      if (a >= seg.at) seg = this.applied(this.numbers.subject(s), seg, change, a);
    }
  this.evaluateSegment(seg, t, xo, vo);
}

/** Subject `s`'s changes waiting, with those a read ahead's tape made filed among them by time. */
export function dueTo<I>(this: Motions<I>, s: number): readonly Change[] | undefined {
  const own = this.pending?.[s];
  const ahead = reading.ahead?.get(this);
  if (ahead === undefined) return own;
  const subject = this.numbers.subject(s);
  const made = subject === absent ? undefined : (ahead.get(subject) as Change[] | undefined);
  if (made === undefined) return own;
  if (own === undefined) return made;
  // The patch's own were made first, and a stable sort keeps them first at one time.
  return [...own.filter((c) => c.at !== undefined), ...made].sort(
    (a, b) => (a.at as number) - (b.at as number),
  );
}

/**
 * Takes back every change made after frame `seq`: each subject plays from its earliest stretch
 * kept, with the changes made by then queued to be applied again.
 */
export function rewind<I>(this: Motions<I>, seq: number): void {
  this.unrelease(seq);
  for (let s = 0; s < this.numbers.size; s++)
    if (this.numbers.subject(s) !== absent) this.cut(s, seq);
}

export function cut<I>(this: Motions<I>, s: number, seq: number): void {
  const older = this.older?.[s];
  const pending = this.pending?.[s];
  const current = this.latest(s);
  const stretches = older === undefined ? [current] : [...older, current];
  const kept: Change[] = [];
  let cut = false;
  for (const c of [...stretches.slice(1).map((seg) => seg.change), ...(pending ?? [])])
    if (c === undefined || c.seq === undefined || !(c.seq > seq)) {
      if (c !== undefined) kept.push(c);
    } else cut = true;
  if (!cut) return;
  if (older !== undefined) {
    (this.older as (Segment[] | undefined)[])[s] = undefined;
    this.flag(s, OLDER, false);
  }
  this.write(s, stretches[0] as Segment);
  // Applied again in the order they take effect; one never stamped waits for the next read.
  const timed = kept
    .filter((c) => c.at !== undefined)
    .sort((a, b) => (a.at as number) - (b.at as number));
  const list = [...timed, ...kept.filter((c) => c.at === undefined)];
  if (list.length === 0) {
    if (pending !== undefined) {
      (this.pending as (Change[] | undefined)[])[s] = undefined;
      this.flag(s, PENDING, false);
    }
    return;
  }
  if (this.pending === null) this.pending = [undefined];
  this.pending[s] = list;
  this.flag(s, PENDING, true);
}

/** The stretch `change` releases from `seg` at `at`, for `subject` or one no longer numbered. */
export function applied<I>(
  this: Motions<I>,
  subject: I | typeof absent,
  seg: Segment,
  change: Change,
  at: number,
): Segment {
  const n = this.n;
  if (landing.x.length < n) landing = { x: new Float64Array(n), v: new Float64Array(n) };
  const { x, v } = landing;
  this.evaluateSegment(seg, at, x, v);
  const xs = change.x ?? numbers(x, 0, n);
  const vs = change.v ?? numbers(v, 0, n);
  const known = subject === absent ? (undefined as I) : subject;
  const put = change.x !== undefined && change.v === undefined;
  const to = this.shape.aim(xs, vs, change.to ?? seg.to, known, put);
  const ms = subject === absent ? seg.ms : (this.shape.ms?.(known) ?? 0);
  return { at, ms, x0: xs, v0: vs, to, change };
}

export function commit<I>(this: Motions<I>, s: number, t: number): void {
  const list = (this.pending as Change[][])[s] as Change[];
  // The first read of a subject no frame had met: those waiting for a time take this one.
  if ((list[list.length - 1] as Change).at === undefined) {
    let i = list.length;
    while (i > 0 && (list[i - 1] as Change).at === undefined) i--;
    for (const c of list.splice(i)) {
      c.at = t;
      this.queue(list, c, t);
    }
  }
  while (list.length > 0) {
    const change = list[0] as Change;
    const a = change.at as number;
    if (a > t) break;
    list.shift();
    this.insert(s, this.applied(this.numbers.subject(s), this.playing(s, a), change, a));
  }
  if (list.length === 0) {
    (this.pending as (Change[] | undefined)[])[s] = undefined;
    this.flag(s, PENDING, false);
  }
}

export function insert<I>(this: Motions<I>, s: number, seg: Segment): void {
  let list = this.older?.[s];
  if (list === undefined) {
    list = [];
    if (this.older === null) this.older = [undefined];
    this.older[s] = list;
    this.flag(s, OLDER, true);
  }
  if (seg.at >= (this.runs[this.base(s)] as number)) {
    list.push(this.latest(s));
    this.write(s, seg);
    return;
  }
  let i = list.length;
  while (i > 0 && (list[i - 1] as Segment).at > seg.at) i--;
  list.splice(i, 0, seg);
}
