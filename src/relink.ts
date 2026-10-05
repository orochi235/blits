import type { Subject } from './mixer.js';

/** What `patch` needs of a voice: its place in voice order. */
interface Ordered {
  readonly id: number;
}

/**
 * The voices over every subject behind each step of a mix's `version`, so a chain linked a few
 * steps back can be brought up to date by those voices alone; null for a step that changed
 * anything else, after which every chain links afresh.
 */
export class Steps<V extends Ordered> {
  private list: (V | null)[] = [];
  /** The version before `list[0]`. */
  private from = 0;

  /** Records the step to `version`, made by `voice`. */
  push(voice: V | null, version: number): void {
    if (this.list.length >= 64) {
      this.list = this.list.slice(32);
      this.from += 32;
    }
    if (this.from + this.list.length !== version - 1) {
      this.list = [];
      this.from = version - 1;
    }
    this.list.push(voice);
  }

  /**
   * A chain linked at `version`, its first record `head` (null where it holds none), with each voice
   * stepped since taken off it or put on at its place in voice order by `reach`, which gives the
   * voice's record where a full relink would link it and null where it would not. undefined where
   * the steps since do not say, so the chain must link afresh.
   */
  patch(
    head: Subject<unknown> | null,
    version: number,
    reach: (voice: V) => Subject<unknown> | null,
  ): Subject<unknown> | null | undefined {
    if (!(version >= this.from)) return undefined;
    const list = this.list;
    for (let k = version - this.from; k < list.length; k++) {
      const voice = list[k];
      if (voice === null || voice === undefined) return undefined;
      let prev: Subject<unknown> | null = null;
      let at = head;
      while (at !== null && (at.voice as V).id < voice.id) {
        prev = at;
        at = at.next;
      }
      const here = at !== null && at.voice === voice ? at : null;
      const want = reach(voice);
      if (want === here) continue;
      const after = here === null ? at : here.next;
      if (want !== null) {
        want.voice = voice;
        want.next = after;
      }
      const link = want ?? after;
      if (prev === null) head = link;
      else prev.next = link;
    }
    return head;
  }
}
