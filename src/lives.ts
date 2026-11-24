import { type Cut, within } from './cut.js';
import { type Motions, RunField } from './motions.js';
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

/** Whether two stretches are one, released at one time by the change made in one frame and moment. */
const same = (a: Segment, b: Segment): boolean =>
  a.at === b.at &&
  Object.is(a.change?.seq, b.change?.seq) &&
  Object.is(a.change?.made, b.change?.made);

/**
 * `segs`, in time order, ahead of `list`: those no later than its first and not in it already. One
 * released at the same time as its first, as under a clock at rate 0, is still the one before it.
 */
function ahead(segs: readonly Segment[], list: Segment[]): Segment[] {
  const first = (list[0] as Segment).at;
  const out: Segment[] = [];
  for (const seg of [...segs].sort((x, y) => x.at - y.at))
    if (seg.at <= first && !out.some((o) => same(o, seg)) && !list.some((o) => same(o, seg)))
      out.push(seg);
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
  this.firsts?.delete(subject);
  this.paged?.delete(subject);
  const s = this.known(subject);
  if (s === undefined) return;
  if (at !== undefined) {
    const kept: typeof this.released = [];
    for (const e of this.released)
      if (e.at >= reach) kept.push(e);
      else
        (this.owner ?? this.pagedBy)?.page(this.ownerId, 'released', e.subject, [
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
    flags: this.runs[this.base(s) + RunField.FLAGS] as number,
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
  this.runs[this.base(s) + RunField.FLAGS] = run.flags & ~(OLDER | PENDING);
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
  // A record holds every stretch in force by its frame; one written before that, a single one.
  const within = (to: number) =>
    back
      .filter((r) => r.seq > from && r.seq <= to)
      .flatMap((r) => (Array.isArray(r.data) ? (r.data as Segment[]) : [r.data as Segment]));
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

/**
 * Whether no read reaches the stretch before one starting at `at`, released by `change`: that one
 * is in force by `reading.horizon`, and was made before the earliest frame a read asks for. A
 * voice whose clock stood still has many frames at one voice time, the earlier ones read before it.
 */
export function outlived<I>(motions: Motions<I>, at: number, change: Change | undefined): boolean {
  if (!(at <= reading.horizon)) return false;
  const made = change?.made;
  return made === undefined || !(made > (motions.owner?.since() ?? Number.POSITIVE_INFINITY));
}

/** The mix time and frame older stretch `i` was in force by, which a store keys it under. */
function byFrame<I>(
  motions: Motions<I>,
  s: number,
  list: readonly Segment[],
  i: number,
): { at: number; seq: number } {
  return motions.made((list[i + 1] as Segment | undefined)?.change ?? motions.causes?.[s]);
}

/** Lets go of stretches no read reaches, older than the one in force at `reading.horizon`. */
export function prune<I>(this: Motions<I>, s: number): void {
  const list = this.older?.[s];
  if (list === undefined) return;
  let n = 0;
  while (
    n < list.length &&
    (n + 1 < list.length
      ? outlived(this, (list[n + 1] as Segment).at, (list[n + 1] as Segment).change)
      : outlived(this, this.runs[this.base(s) + RunField.AT] as number, this.causes?.[s]))
  )
    n++;
  if (n === 0) return;
  const subject = this.numbers.subject(s);
  const owner = this.owner ?? this.pagedBy;
  if (owner !== null && subject !== absent) {
    // A store keeps one record per frame, so it holds every stretch in force by that frame.
    const out: Paging[] = [];
    for (let i = 0; i < n; i++) {
      const by = byFrame(this, s, list, i);
      const last = out[out.length - 1];
      if (last?.seq === by.seq) (last.data as Segment[]).push(list[i] as Segment);
      else out.push({ ...by, data: [list[i]] });
    }
    const first = out[0] as Paging;
    const before = this.paged?.get(subject);
    if (before !== undefined) {
      this.paged?.delete(subject);
      if (before.seq === first.seq)
        first.data = [...(before.data as Segment[]), ...(first.data as Segment[])];
    }
    // One still kept, or the frame still playing, may yet leave a stretch in force by its frame.
    const last = out[out.length - 1] as Paging;
    const next =
      n < list.length ? byFrame(this, s, list, n).seq : (this.owner?.seq() ?? Number.NaN);
    if (last.seq === next) {
      this.paged ??= new Map();
      this.paged.set(subject, last);
    }
    owner.page(this.ownerId, 'stretch', subject, out);
  }
  list.splice(0, n);
  if (list.length === 0) {
    (this.older as (Segment[] | undefined)[])[s] = undefined;
    this.flag(s, OLDER, false);
  }
}
