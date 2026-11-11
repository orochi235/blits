import { byId, insertById } from './sorted.js';
import { Store } from './store.js';

/** What a `Filed` index keeps of a voice: what it names, and the group it joined. */
export interface Filer<I> {
  readonly id: number;
  readonly named: { readonly list: readonly I[] } | null;
  /** The group it is filed in, or null where it is filed under each subject itself. */
  group: Group<unknown> | null;
}

/**
 * The voices naming one list of many subjects, in id order: listed under each subject once for all
 * of them, so a voice joins or leaves with no work per subject. A dead group, whose voices have all
 * left, stays listed under its subjects until `sweep` takes it off them.
 */
export class Group<V> {
  voices: V[] = [];
  /** How far down `list` the sweep has taken a dead group off; -1 before it begins. */
  at = -1;

  constructor(readonly list: readonly unknown[]) {}
}

/** The fewest subjects a voice names to be filed in a group rather than under each subject. */
const WIDE = 1024;
/** The most groups naming as many subjects a voice is compared with before it starts its own. */
const TRIED = 4;
/** The fewest subjects a sync's sweep looks at while any dead group is still listed. */
const FLOOR = 4096;
/** The share of the subjects dead groups are still listed under that a sync's sweep looks at, at least. */
const SHARE = 1 / 256;

/**
 * Per subject, the voices naming it, in voice order. A voice naming few subjects is filed under
 * each, and taken off each as it leaves. Voices naming many are filed by group, so a voice naming
 * a million subjects joins or leaves in no time where another names the same list, and a group
 * left by its last voice is taken off its subjects a bounded share each sync.
 */
export class Filed<I, V extends Filer<I>> {
  private readonly lists = new Store<I, (V | Group<V>)[]>();
  /** Groups a voice may still join, by how many subjects they name. */
  private readonly groups = new Map<number, Group<V>[]>();
  /** Groups listed under some subject: while none are, every list holds only voices. */
  private wide = 0;
  /** Dead groups still listed, oldest first, and how many subjects they are still listed under. */
  private readonly dead: Group<V>[] = [];
  private pending = 0;

  /** The voices naming `subject`, in voice order; undefined where none do. Not to be changed. */
  get(subject: I): V[] | undefined {
    const raw = this.lists.get(subject);
    if (raw === undefined || raw.length === 0) return undefined;
    if (this.wide === 0) return raw as V[];
    if (raw.length === 1) {
      const only = raw[0];
      if (!(only instanceof Group)) return raw as V[];
      return only.voices.length > 0 ? only.voices : undefined;
    }
    let grouped = false;
    for (const e of raw) if (e instanceof Group) grouped = true;
    if (!grouped) return raw as V[];
    const out: V[] = [];
    for (const e of raw) {
      if (e instanceof Group) for (const v of e.voices) out.push(v);
      else out.push(e);
    }
    return out.length > 0 ? byId(out) : undefined;
  }

  file(voice: V): void {
    const list = (voice.named as { list: readonly I[] }).list;
    if (list.length < WIDE) {
      voice.group = null;
      this.under(list, voice);
      return;
    }
    let g = this.match(list);
    if (g === null) {
      g = new Group<V>(list);
      const same = this.groups.get(list.length);
      if (same === undefined) this.groups.set(list.length, [g]);
      else same.push(g);
      this.wide++;
      this.under(list, g);
    } else if (g.voices.length === 0) {
      this.dead.splice(this.dead.indexOf(g), 1);
      this.pending -= list.length;
    }
    insertById(g.voices, voice);
    voice.group = g as Group<unknown>;
  }

  unfile(voice: V): void {
    const g = voice.group as Group<V> | null;
    if (g === null) {
      this.off((voice.named as { list: readonly I[] }).list, voice);
      return;
    }
    voice.group = null;
    const i = g.voices.indexOf(voice);
    if (i >= 0) g.voices.splice(i, 1);
    if (g.voices.length > 0) return;
    this.dead.push(g);
    this.pending += g.list.length;
  }

  /** Takes dead groups off the next subjects they are listed under, as many as this sync's share. */
  sweep(): void {
    const dead = this.dead;
    if (dead.length === 0) return;
    let budget = Math.max(FLOOR, Math.ceil(this.pending * SHARE));
    while (dead.length > 0 && budget > 0) {
      const g = dead[0] as Group<V>;
      if (g.at < 0) {
        g.at = 0;
        const same = this.groups.get(g.list.length) as Group<V>[];
        same.splice(same.indexOf(g), 1);
        if (same.length === 0) this.groups.delete(g.list.length);
      }
      const list = g.list as readonly I[];
      const end = Math.min(list.length, g.at + budget);
      this.off(list, g, g.at, end);
      budget -= end - g.at;
      this.pending -= end - g.at;
      g.at = end;
      if (end < list.length) break;
      dead.shift();
      this.wide--;
    }
  }

  /** A group `list` may join: one naming the same subjects in the same order that is not being swept. */
  private match(list: readonly I[]): Group<V> | null {
    const same = this.groups.get(list.length);
    if (same === undefined) return null;
    for (let k = 0; k < same.length && k < TRIED; k++) {
      const g = same[k] as Group<V>;
      if (g.at < 0 && equal(g.list, list)) return g;
    }
    return null;
  }

  private under(subjects: readonly I[], entry: V | Group<V>): void {
    const lists = this.lists;
    for (const subject of subjects) {
      const list = lists.get(subject);
      if (list === undefined) lists.set(subject, [entry]);
      else list.push(entry);
    }
  }

  private off(subjects: readonly I[], entry: V | Group<V>, from = 0, to = subjects.length): void {
    const lists = this.lists;
    for (let s = from; s < to; s++) {
      const subject = subjects[s] as I;
      const list = lists.get(subject);
      if (list === undefined) continue;
      const i = list.indexOf(entry);
      if (i < 0) continue;
      // Shifted by hand: `splice` makes an array of what it took, once a subject.
      for (let k = i + 1; k < list.length; k++) list[k - 1] = list[k] as V | Group<V>;
      list.pop();
      // An object's emptied list stays for the next voice naming it, which the WeakMap drops with
      // the subject: deleting a million shrinks the table, a 17 ms frame, and the next scene grows it back.
      if (list.length === 0 && (typeof subject !== 'object' || subject === null))
        lists.delete(subject);
    }
  }
}

function equal(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  const n = a.length;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
