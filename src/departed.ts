import { markOf, voiceMarks } from './marks.js';
import type { Mixer } from './mixer.js';
import type { Mark, MarkName, Query } from './types.js';
import { none, type Voice } from './voice.js';

/**
 * What a mix keeps of a voice it has forgotten, on leaving without history or past history's reach:
 * what a query matches it by and the times of its marks, so an anchor that no voice the mix still
 * knows answers can find it.
 */
export interface Departed {
  readonly id: number;
  readonly score: string | undefined;
  /** Its owner's id, -1 for none. */
  readonly owner: number;
  readonly name: string | undefined;
  readonly tags: readonly string[];
  readonly writes: readonly unknown[];
  /** Its five, and those it placed inside itself. */
  readonly marks: Readonly<Partial<Record<MarkName, number>>>;
  /** How many of the index's ends hold it. */
  held: number;
}

interface End {
  first: Departed;
  last: Departed;
}

/** The ends kept within one score and owner. */
interface Scope {
  whole: End | undefined;
  readonly names: Map<string, End>;
  readonly tags: Map<string, End>;
  readonly writes: Map<unknown, End>;
}

/** A departed voice's marks: its five as fields, so it stays in fast mode, on no prototype. */
class Marks {
  [name: string]: number | undefined;
  start: number | undefined = undefined;
  in: number | undefined = undefined;
  coast: number | undefined = undefined;
  out: number | undefined = undefined;
  end: number | undefined = undefined;
}
Object.setPrototypeOf(Marks.prototype, null);

/**
 * The departed voices a query could still pick: for each name, tag and channel within a score and
 * owner, the first and the last to leave. It grows with those, never with how many voices left.
 */
export class DepartedIndex {
  private readonly scopes = new Map<string | undefined, Map<number, Scope>>();
  readonly all = new Set<Departed>();

  add<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
    // Nothing can be cued beside a voice whose owner has gone, so nothing will ask for it.
    if (voice.owner?.state === 'done') return;
    const marks = new Marks();
    for (let i = 0; i < voiceMarks.length; i++) {
      const mark = voiceMarks[i] as Mark;
      marks[mark] = markOf(mix, voice, mark);
    }
    const inner = voice.spec.marks;
    if (inner !== undefined)
      for (const mark of Object.keys(inner)) marks[mark] = markOf(mix, voice, mark);
    const d: Departed = {
      id: voice.id,
      score: voice.spec.score,
      owner: voice.owner?.id ?? -1,
      name: voice.spec.name,
      tags: voice.spec.tags ?? none,
      writes: voice.patch.writes,
      marks,
      held: 0,
    };
    const scope = this.scopeOf(d.score, d.owner);
    if (scope.whole === undefined) {
      scope.whole = { first: d, last: d };
      d.held += 2;
    } else this.hold(scope.whole, d);
    if (d.name !== undefined) this.keep(scope.names, d.name, d);
    for (let i = 0; i < d.tags.length; i++) this.keep(scope.tags, d.tags[i], d);
    for (let i = 0; i < d.writes.length; i++) this.keep(scope.writes, d.writes[i], d);
    if (d.held > 0) this.all.add(d);
    if (voice.holding !== null) this.dropOwner(voice.id);
  }

  /** Lets go of the voices an owner that has left held: nothing can be cued beside them again. */
  dropOwner(owner: number): void {
    for (const owners of this.scopes.values()) {
      const scope = owners.get(owner);
      if (scope === undefined) continue;
      owners.delete(owner);
      if (scope.whole !== undefined) this.forget(scope.whole);
      for (const end of scope.names.values()) this.forget(end);
      for (const end of scope.tags.values()) this.forget(end);
      for (const end of scope.writes.values()) this.forget(end);
    }
  }

  private scopeOf(score: string | undefined, owner: number): Scope {
    let owners = this.scopes.get(score);
    if (owners === undefined) {
      owners = new Map();
      this.scopes.set(score, owners);
    }
    let scope = owners.get(owner);
    if (scope === undefined) {
      scope = { whole: undefined, names: new Map(), tags: new Map(), writes: new Map() };
      owners.set(owner, scope);
    }
    return scope;
  }

  private keep<K>(ends: Map<K, End>, key: K, d: Departed): void {
    const end = ends.get(key);
    if (end === undefined) {
      ends.set(key, { first: d, last: d });
      d.held += 2;
    } else this.hold(end, d);
  }

  private hold(end: End, d: Departed): void {
    this.release(end.last);
    end.last = d;
    d.held++;
  }

  private forget(end: End): void {
    this.all.delete(end.first);
    this.all.delete(end.last);
  }

  private release(d: Departed): void {
    if (--d.held === 0) this.all.delete(d);
  }
}

/** Whether a departed voice answers `q`, asked by a voice of `owner` (-1 for none) on `score`. */
export function departedMatches(
  d: Departed,
  q: Query,
  score: string | undefined,
  anywhere: boolean,
  owner: number,
): boolean {
  return (
    d.score === score &&
    (anywhere || d.owner === owner) &&
    (q.name === undefined || d.name === q.name) &&
    (q.tag === undefined || d.tags.includes(q.tag)) &&
    (q.writes === undefined || d.writes.includes(q.writes))
  );
}
