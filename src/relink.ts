import type { Subject } from './voice.js';

/** What `patch` needs of a voice: its place in voice order. */
interface Ordered {
  readonly id: number;
}

/** What `patch` asks a mix: a voice's record for a subject where a full relink would link it. */
interface Linker<V, I> {
  linkable(voice: V, subject: I, slot: number): Subject<unknown> | null;
}

/**
 * The voices over every subject behind each step of a mix's `version`, so a chain linked a few
 * steps back can be brought up to date by those voices alone; null for a step that changed
 * anything else, after which every chain links afresh.
 */
export class Steps<V extends Ordered, I> {
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
   * stepped since taken off it or put on at its place in voice order by `mix.linkable`, which gives
   * the voice's record where a full relink would link it and null where it would not. undefined
   * where the steps since do not say, so the chain must link afresh. It takes the mix and the
   * subject, not a function closed over them: a closure and its context a subject cost the `swap`
   * row about 138 B each (bench/allocs.mjs, 2026-10-09).
   */
  patch(
    head: Subject<unknown> | null,
    version: number,
    mix: Linker<V, I>,
    subject: I,
    slot: number,
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
      const want = mix.linkable(voice, subject, slot);
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
