import { EMPTIED, emptied } from './named.js';
import { byId, insertById } from './sorted.js';
import { Store } from './store.js';

/** What a `Filed` index keeps of a voice: what it names, and the group it joined. */
export interface Filer<I> {
  readonly id: number;
  readonly named: { readonly list: readonly I[]; has(subject: I): boolean } | null;
  /** The group the mix's named index files it in, or null where it is filed under each subject itself. */
  group: Group<unknown> | null;
  /** The same, for the index of gone voices. */
  goneGroup?: Group<unknown> | null;
}

/** Which of a voice's fields an index keeps its group in: a voice can be in two at once. */
export type GroupSlot = 'group' | 'goneGroup';

/**
 * The voices naming one list of many subjects, in id order: listed under each subject once for all
 * of them, so a voice joins or leaves with no work per subject. A dead group, whose voices have all
 * left, stays listed under its subjects until `sweep` takes it off them.
 */
export class Group<V> {
  voices: V[] = [];
  /** How far down `list` the group is listed: a sync's sweep files a long one a share at a time. */
  filed = 0;
  /** How far down `list` the sweep has taken a dead group off; -1 before it begins. */
  at = -1;

  constructor(
    readonly list: readonly unknown[],
    /** Whether `list` names a subject, for those it is not yet listed under. */
    readonly has: (subject: never) => boolean,
  ) {}
}

/** The fewest subjects a voice names to be filed in a group rather than under each subject. */
const WIDE = 1024;
/** The most groups naming as many subjects a voice is compared with before it starts its own. */
const TRIED = 4;
/** The fewest subjects a sync's sweep looks at while any dead group is still listed. */
const FLOOR = 4096;
/** The share of the subjects dead groups are still listed under that a sync's sweep looks at, at least. */
const SHARE = 1 / 256;
/** The most subjects a new group is listed under as it is made; a longer list is filed by the sweep. */
const AT_ONCE = FLOOR;

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
  /** Live groups not yet listed under all their subjects, oldest first, and how many subjects that leaves. */
  private readonly filing: Group<V>[] = [];
  private unfiled = 0;

  constructor(private readonly slot: GroupSlot = 'group') {}

  /** The voices naming `subject`, in voice order; undefined where none do. Not to be changed. */
  get(subject: I): V[] | undefined {
    const raw = this.lists.get(subject);
    if (this.filing.length > 0) {
      const out = this.unlisted(subject, raw);
      if (out !== null) return out;
    }
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
      voice[this.slot] = null;
      this.under(list, voice);
      return;
    }
    let g = this.match(list);
    if (g === null) {
      const named = voice.named as { has(subject: I): boolean };
      g = new Group<V>(list, (s: I) => named.has(s));
      const same = this.groups.get(list.length);
      if (same === undefined) this.groups.set(list.length, [g]);
      else same.push(g);
      this.wide++;
      if (list.length <= AT_ONCE) {
        this.under(list, g);
        g.filed = list.length;
      } else {
        this.filing.push(g);
        this.unfiled += list.length;
      }
    } else if (g.voices.length === 0) {
      this.dead.splice(this.dead.indexOf(g), 1);
      this.pending -= g.filed;
      if (g.filed < list.length) {
        this.filing.push(g);
        this.unfiled += list.length - g.filed;
      }
    }
    insertById(g.voices, voice);
    voice[this.slot] = g as Group<unknown>;
  }

  unfile(voice: V): void {
    const g = (voice[this.slot] ?? null) as Group<V> | null;
    if (g === null) {
      this.off((voice.named as { list: readonly I[] }).list, voice);
      return;
    }
    voice[this.slot] = null;
    const i = g.voices.indexOf(voice);
    if (i >= 0) g.voices.splice(i, 1);
    if (g.voices.length > 0) return;
    const f = this.filing.indexOf(g);
    if (f >= 0) {
      this.filing.splice(f, 1);
      this.unfiled -= g.list.length - g.filed;
    }
    this.dead.push(g);
    this.pending += g.filed;
  }

  /**
   * Lists new groups under the next subjects they name, and takes dead groups off the next they are
   * listed under, each as many as this sync's share.
   */
  sweep(): void {
    this.fill();
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
      const end = Math.min(g.filed, g.at + budget);
      this.off(list, g, g.at, end);
      budget -= end - g.at;
      this.pending -= end - g.at;
      g.at = end;
      if (end < g.filed) break;
      dead.shift();
      this.wide--;
    }
  }

  private fill(): void {
    const filing = this.filing;
    if (filing.length === 0) return;
    let budget = Math.max(FLOOR, Math.ceil(this.unfiled * SHARE));
    while (filing.length > 0 && budget > 0) {
      const g = filing[0] as Group<V>;
      const list = g.list as readonly I[];
      const end = Math.min(list.length, g.filed + budget);
      this.under(list, g, g.filed, end);
      budget -= end - g.filed;
      this.unfiled -= end - g.filed;
      g.filed = end;
      if (end < list.length) break;
      filing.shift();
    }
  }

  /**
   * A subject's voices where a group still filing names it and is not yet listed under it, in
   * voice order; null where none is.
   */
  private unlisted(subject: I, raw: (V | Group<V>)[] | undefined): V[] | null {
    let out: V[] | null = null;
    for (const g of this.filing) {
      if (raw !== undefined && raw.includes(g)) continue;
      if (!(g.has as (s: I) => boolean)(subject)) continue;
      out ??= [];
      for (const v of g.voices) out.push(v);
    }
    if (out === null) return null;
    if (raw !== undefined)
      for (const e of raw) {
        if (e instanceof Group) for (const v of e.voices) out.push(v);
        else out.push(e);
      }
    return byId(out);
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

  private under(subjects: readonly I[], entry: V | Group<V>, from = 0, to = subjects.length): void {
    const lists = this.lists;
    for (let s = from; s < to; s++) {
      const subject = subjects[s] as I;
      const list = lists.get(subject);
      if (list === undefined || list === EMPTIED) lists.set(subject, [entry]);
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
      if (list.length === 0) emptied(lists, subject);
    }
  }
}

function equal(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  const n = a.length;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
