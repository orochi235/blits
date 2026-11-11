import { shownFrom } from '../held.js';
import type { Mixer } from '../mixer.js';
import { startedAt } from '../origin.js';
import type { Voice } from '../voice.js';

/** A voice's `sinceOf` and `shownOf` at one moment, its start worked out once for all its delays. */
export class Origins {
  private readonly start: number;

  constructor(
    private readonly mix: Mixer<unknown, unknown>,
    private readonly voice: Voice<unknown, unknown>,
  ) {
    this.start = startedAt(voice);
  }

  since(delay: number): number {
    return this.mix.sinceOf(this.voice, delay);
  }

  shown(since: number): number {
    return shownFrom(this.voice, since, this.start);
  }
}
