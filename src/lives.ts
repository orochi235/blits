import { type Cut, within } from './cut.js';
import type { Motions } from './motions.js';
import { absent } from './numbers.js';
import { reading } from './reading.js';
import { type Change, type Paging, type Run, RunFlag, type Segment } from './stretch.js';

const PENDING = RunFlag.PENDING;
const OLDER = RunFlag.OLDER;

/** A run a release kept, with when: `early` where the release came before anything read its frame. */
export type Released<I> = { subject: I; at: number; seq: number; early: boolean } & Run;

/** A run that shares nothing with the patch's own. */
const runOf = (r: Run): Run => ({
  flags: r.flags,
  stretches: r.stretches.map((seg) => ({ ...seg })),
  pending: r.pending?.map((c) => ({ ...c })),
});

/** `segs`, in time order, ahead of `list`: those older than its first, one per time. */
function ahead(segs: readonly Segment[], list: Segment[]): Segment[] {
  const first = (list[0] as Segment).at;
  const out: Segment[] = [];
  for (const seg of [...segs].sort((x, y) => x.at - y.at))
    if (seg.at < first && out[out.length - 1]?.at !== seg.at) out.push(seg);
  return out.length === 0 ? list : [...out, ...list];
}

/**
 * Forgets a subject, so a later ask starts it afresh from `from`. Given the mix time `at` and frame
 * `seq`, under history, its run is kept for a rewind before then, until `reach` passes it.
 */
export function release<I>(
  this: Motions<I>,
  subject: I,
  at?: number,
  reach = Number.NEGATIVE_INFINITY,
  seq = Number.NaN,
  early = false,
): void {
  const s = this.known(subject);
  if (s === undefined) return;
  if (at !== undefined) {
    const kept: typeof this.released = [];
    for (const e of this.released)
      if (e.at >= reach) kept.push(e);
      else
        this.owner?.page(this.ownerId, 'released', e.subject, [
          { at: e.at, seq: e.seq, data: { ...runOf(e), early: e.early } },
        ]);
    this.released = kept;
    this.released.push({ subject, at, seq, early, ...this.runAt(s) });
  }
  this.slots.delete(subject);
  this.numbers.release(s);
}

/** Puts back each subject released after frame `seq`, as it stood when released. */
export function unrelease<I>(this: Motions<I>, seq: number): void {
  const back = this.released.filter((e) => e.seq > seq).sort((a, b) => a.seq - b.seq);
  if (back.length === 0) return;
  this.released = this.released.filter((e) => e.seq <= seq);
  const done = new Set<I>();
  for (const e of back) {
    if (done.has(e.subject)) continue;
    done.add(e.subject);
    this.unpack(e.subject, e);
  }
}

/** Subject `s`'s run as it stands. */
export function runAt<I>(this: Motions<I>, s: number): Run {
  const older = this.older?.[s];
  const pending = this.pending?.[s];
  return {
    flags: this.runs[this.base(s) + 1] as number,
    stretches: older === undefined ? [this.latest(s)] : [...older, this.latest(s)],
    pending: pending === undefined ? undefined : [...pending],
  };
}

/** A subject's run as plain data, for a voice leaving memory; undefined where it has none. */
export function pack<I>(this: Motions<I>, subject: I): Run | undefined {
  const s = this.known(subject);
  return s === undefined ? undefined : runOf(this.runAt(s));
}

/** Puts a subject's run back as `pack` or a release left it, replacing any it has now. */
export function unpack<I>(this: Motions<I>, subject: I, run: Run): void {
  const now = this.known(subject);
  if (now !== undefined) {
    this.slots.delete(subject);
    this.numbers.release(now);
  }
  if (this.n < 0) this.size((run.stretches[0] as Segment).x0.length);
  const s = this.take(subject);
  this.runs[this.base(s) + 1] = run.flags & ~(OLDER | PENDING);
  const latest = run.stretches[run.stretches.length - 1] as Segment;
  this.write(s, latest);
  if (run.stretches.length > 1) {
    if (this.older === null) this.older = [undefined];
    this.older[s] = run.stretches.slice(0, -1);
    this.flag(s, OLDER, true);
  }
  if (run.pending !== undefined) {
    if (this.pending === null) this.pending = [undefined];
    this.pending[s] = run.pending;
    this.flag(s, PENDING, true);
  }
}

/** A released run a history store gave back, for a rewind to before its release. */
export function reclaim<I>(
  this: Motions<I>,
  subject: I,
  at: number,
  seq: number,
  run: Run & { early?: boolean },
): void {
  if (this.released.some((e) => e.seq === seq && Object.is(e.subject, subject))) return;
  this.released.push({ subject, at, seq, ...run, early: run.early === true });
}

/**
 * The run `subject` had in frame `cut`: the one a release after the cut kept, else the one it has
 * now; undefined where it has neither. Its changes after the cut are still on it.
 */
export function runThen<I>(this: Motions<I>, subject: I, cut: Cut): Run | undefined {
  let life: Released<I> | undefined;
  for (const e of this.released)
    if (
      Object.is(e.subject, subject) &&
      !within(cut, e.seq, e.early) &&
      (life === undefined || e.seq < life.seq)
    )
      life = e;
  if (life !== undefined) return life;
  const s = this.known(subject);
  return s === undefined ? undefined : this.runAt(s);
}

/**
 * Stretches a history store gave back, each by the frame it was in force by: each life of the
 * subject, ended by a release, takes those from its own, ahead of the earliest it still keeps.
 */
export function restretch<I>(this: Motions<I>, subject: I, back: readonly Paging[]): void {
  const lives = this.released
    .filter((e) => Object.is(e.subject, subject))
    .sort((x, y) => x.seq - y.seq);
  let from = Number.NEGATIVE_INFINITY;
  const within = (to: number) =>
    back.filter((r) => r.seq > from && r.seq <= to).map((r) => r.data as Segment);
  for (const e of lives) {
    e.stretches = ahead(within(e.seq), e.stretches);
    from = e.seq;
  }
  const s = this.known(subject);
  if (s === undefined) return;
  const older = this.older?.[s] ?? [];
  const list = ahead(within(Number.POSITIVE_INFINITY), [...older, this.latest(s)]);
  if (list.length === older.length + 1) return;
  if (this.older === null) this.older = [undefined];
  this.older[s] = list.slice(0, -1);
  this.flag(s, OLDER, true);
}

/**
 * The mix time and frame a stretch was in force by, which a store keys it under: when the change
 * that ended it was made, which falls in the same life of the subject.
 */
export function made<I>(this: Motions<I>, c: Change | undefined): { at: number; seq: number } {
  const made = c?.made;
  if (made === undefined || Number.isNaN(made))
    return { at: this.owner?.now() ?? Number.NaN, seq: this.owner?.seq() ?? Number.NaN };
  return { at: made, seq: c?.seq ?? Number.NaN };
}

/** Lets go of stretches older than the one in force at `reading.horizon`. */
export function prune<I>(this: Motions<I>, s: number): void {
  const list = this.older?.[s];
  if (list === undefined) return;
  let n = 0;
  while (
    n < list.length &&
    (n + 1 < list.length ? (list[n + 1] as Segment).at : (this.runs[this.base(s)] as number)) <=
      reading.horizon
  )
    n++;
  if (n === 0) return;
  const out = list.splice(0, n);
  const subject = this.numbers.subject(s);
  if (this.owner !== null && subject !== absent)
    this.owner.page(
      this.ownerId,
      'stretch',
      subject,
      out.map((seg, i) => {
        const next = out[i + 1] ?? list[0];
        return { ...this.made(next === undefined ? this.causes?.[s] : next.change), data: seg };
      }),
    );
  if (list.length === 0) {
    (this.older as (Segment[] | undefined)[])[s] = undefined;
    this.flag(s, OLDER, false);
  }
}
