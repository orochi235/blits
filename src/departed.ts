import { markOf } from './marks.js';
import type { Mixer } from './mixer.js';
import type { Mark, Query } from './types.js';
import { none, type Voice } from './voice.js';

const MARKS: readonly Mark[] = ['start', 'in', 'coast', 'out', 'end'];

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
  readonly marks: Readonly<Record<Mark, number | undefined>>;
  /** How many of the index's ends hold it. */
  held: number;
}

/**
 * The departed voices a query could still pick: for each name, tag and channel within a score and
 * owner, the first and the last to leave. It grows with those, never with how many voices left.
 */
export class DepartedIndex {
  private readonly ends = new Map<string, { first: Departed; last: Departed }>();
  readonly all = new Set<Departed>();

  add<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
    // Nothing can be cued beside a voice whose owner has gone, so nothing will ask for it.
    if (voice.owner?.state === 'done') return;
    const marks = {} as Record<Mark, number | undefined>;
    for (const mark of MARKS) marks[mark] = markOf(mix, voice, mark);
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
    const base = `${d.score ?? ''}\u0000${d.owner}\u0000`;
    const keys = [`${base}w`];
    if (d.name !== undefined) keys.push(`${base}n\u0000${d.name}`);
    for (const tag of d.tags) keys.push(`${base}t\u0000${tag}`);
    for (const ch of d.writes) keys.push(`${base}c\u0000${String(ch)}`);
    for (const key of keys) {
      const end = this.ends.get(key);
      if (end === undefined) {
        this.ends.set(key, { first: d, last: d });
        d.held += 2;
        continue;
      }
      this.release(end.last);
      end.last = d;
      d.held++;
    }
    if (d.held > 0) this.all.add(d);
    if (voice.holding !== null) this.dropOwner(voice.id);
  }

  /** Lets go of the voices an owner that has left held: nothing can be cued beside them again. */
  dropOwner(owner: number): void {
    for (const [key, end] of this.ends)
      if (end.first.owner === owner) {
        this.ends.delete(key);
        this.all.delete(end.first);
        this.all.delete(end.last);
      }
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
