import { shownFrom } from '../held.js';
import type { Mixer } from '../mixer.js';
import { startedAt } from '../origin.js';
import type { Voice } from '../voice.js';

/** Past this many distinct delays, each is worked out where asked rather than looked up. */
const MOST = 1024;

/**
 * A voice's `sinceOf` and `shownOf` at one moment, for every subject of a timing block: its start
 * worked out once, and each distinct delay's origin once while there are few, as a stagger over
 * a million subjects usually has.
 */
export class Origins {
  private memo: Map<number, number> | null = new Map();
  private readonly start: number;

  constructor(
    private readonly mix: Mixer<unknown, unknown>,
    private readonly voice: Voice<unknown, unknown>,
  ) {
    this.start = startedAt(voice);
  }

  since(delay: number): number {
    const memo = this.memo;
    if (memo === null) return this.mix.sinceOf(this.voice, delay);
    let s = memo.get(delay);
    if (s !== undefined) return s;
    s = this.mix.sinceOf(this.voice, delay);
    if (memo.size < MOST) memo.set(delay, s);
    else this.memo = null;
    return s;
  }

  shown(since: number): number {
    return shownFrom(this.voice, since, this.start);
  }
}
