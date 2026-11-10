import { Store } from './store.js';

/** What a `Filed` index keeps of a voice: what it names, and where the index has it. */
export interface Filer<I> {
  readonly id: number;
  readonly named: { readonly list: readonly I[] } | null;
  /** The index it is filed in, or null while in none. */
  filed: object | null;
  /** Its entries still listed in an index it left, or null where none are. */
  unfiled: Unfiled | null;
}

/** A voice gone from a `Filed` index whose entries are still listed there. */
export interface Unfiled {
  readonly from: object;
  readonly voice: Filer<unknown>;
  /** Its entries still listed. */
  left: number;
  /** How far down its `named.list` the sweep has looked. */
  at: number;
}

/** The fewest subjects a sync's sweep looks at, while any voice gone is still listed. */
const FLOOR = 8192;
/** The share of what is still to look at that a sync's sweep looks at, at least. */
const SHARE = 1 / 64;

/**
 * Per subject, the voices naming it, in the order filed. A voice leaving is marked gone at once
 * and taken off its subjects' lists later: by whoever reads a list, and by `sweep` each sync,
 * which looks at a bounded share of the subjects still to look at, so a voice naming a million
 * subjects leaves in no one frame.
 */
export class Filed<I, V extends Filer<I>> {
  private readonly lists = new Store<I, V[]>();
  private queue: Unfiled[] = [];
  /** Subjects the voices in `queue` name that the sweep has not looked at. */
  private pending = 0;

  /** The voices naming `subject`, gone ones taken off first; undefined where none do. */
  get(subject: I): V[] | undefined {
    const list = this.lists.get(subject);
    return list === undefined ? undefined : this.compact(subject, list);
  }

  file(voice: V): void {
    const was = voice.unfiled;
    // A voice filed again before its old entries went would be listed twice.
    if (was !== null && was.from === this) this.purge(was);
    voice.unfiled = null;
    voice.filed = this;
    const lists = this.lists;
    for (const subject of (voice.named as { list: readonly I[] }).list) {
      const list = lists.get(subject);
      if (list === undefined) lists.set(subject, [voice]);
      else list.push(voice);
    }
  }

  unfile(voice: V): void {
    voice.filed = null;
    const n = (voice.named as { list: readonly I[] }).list.length;
    if (n === 0) return;
    const u: Unfiled = { from: this, voice, left: n, at: 0 };
    voice.unfiled = u;
    this.queue.push(u);
    this.pending += n;
  }

  /** Takes gone voices off the lists of the next subjects they name, as many as this sync's share. */
  sweep(): void {
    const queue = this.queue;
    if (queue.length === 0) return;
    let budget = Math.max(FLOOR, Math.ceil(this.pending * SHARE));
    let done = 0;
    while (done < queue.length && budget > 0) {
      const u = queue[done] as Unfiled;
      const list = (u.voice.named as { list: readonly I[] }).list;
      while (u.left > 0 && u.at < list.length && budget > 0) {
        const subject = list[u.at++] as I;
        budget--;
        this.pending--;
        const listed = this.lists.get(subject);
        if (listed !== undefined) this.compact(subject, listed);
      }
      if (u.left > 0 && u.at < list.length) break;
      // Readers took the rest off already.
      this.pending -= list.length - u.at;
      u.at = list.length;
      if (u.voice.unfiled === u) u.voice.unfiled = null;
      done++;
    }
    if (done > 0) queue.splice(0, done);
  }

  /** Takes gone voices off `list`, deleting it where none is left. */
  private compact(subject: I, list: V[]): V[] | undefined {
    let kept = 0;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const v = list[i] as V;
      if (v.filed === this) {
        list[kept++] = v;
        continue;
      }
      const u = v.unfiled;
      if (u !== null && u.from === this) u.left--;
    }
    if (kept === n) return list;
    if (kept === 0) {
      this.lists.delete(subject);
      return undefined;
    }
    list.length = kept;
    return list;
  }

  /** Takes every entry of a gone voice off at once. */
  private purge(u: Unfiled): void {
    const list = (u.voice.named as { list: readonly I[] }).list;
    for (let i = u.at; i < list.length && u.left > 0; i++) {
      const subject = list[i] as I;
      const listed = this.lists.get(subject);
      if (listed !== undefined) this.compact(subject, listed);
    }
    this.pending -= list.length - u.at;
    u.at = list.length;
    u.left = 0;
    const k = this.queue.indexOf(u);
    if (k >= 0) this.queue.splice(k, 1);
  }
}
