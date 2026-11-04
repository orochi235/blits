import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { reaches } from './unread.js';

/**
 * The voices the gpu side has folded, for the mix's `unheld`: where the GPU folds a voice the CPU
 * keeps no record of its subjects, so a change made to one is timed as a host probing every frame
 * would have it, by the delay the record would hold.
 */
export class Met<I> {
  private readonly voices = new WeakSet<Voice<I, unknown>>();
  private readonly hook: NonNullable<Mixer<I, unknown>['unheld']>;

  constructor(
    private readonly mix: Mixer<I, unknown>,
    answers: () => Answers<I>,
  ) {
    this.hook = (voice, subject) => {
      if (!this.voices.has(voice)) return undefined;
      const a = answers();
      const i = a.index(subject);
      if (i === undefined) return undefined;
      if (!varies(voice as Voice<unknown, unknown>)) return 0;
      const { delays, reach } = a.of(voice);
      return reaches(reach, i) ? (delays?.[i] ?? 0) : undefined;
    };
    mix.unheld = this.hook;
  }

  /** This frame's folded voices: the CPU would hold a record of each subject they reach from now. */
  mark(voices: readonly Voice<I, unknown>[]): void {
    for (const v of voices) this.voices.add(v);
  }

  close(): void {
    if (this.mix.unheld === this.hook) this.mix.unheld = null;
  }
}
