import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import { reaches } from './unread.js';

/** The fold that last marked a voice, and the cue it marked: a park and a cue again make another. */
interface Mark {
  readonly fold: number;
  readonly cuedSeq: number;
}

/**
 * The voices the gpu side has folded, for the mix's `unheld`: where the GPU folds a voice the CPU
 * keeps no record of its subjects, so a change made to one is timed as a host probing every frame
 * would have it, by the delay the record would hold. Forgets what the CPU would: a voice parked by
 * a seek back before its cue, and a dropped subject, until a fold meets them again.
 */
export class Met<I> {
  private readonly marks = new WeakMap<Voice<I, unknown>, Mark>();
  /** Registered subjects dropped since a fold, by the count of folds then. */
  private readonly dropped = new Map<I, number>();
  private folds = 0;
  private readonly hook: NonNullable<Mixer<I, unknown>['unheld']>;
  private readonly drop: NonNullable<Mixer<I, unknown>['unmet']>;

  constructor(
    private readonly mix: Mixer<I, unknown>,
    answers: () => Answers<I>,
  ) {
    this.hook = (voice, subject) => {
      const mark = this.marks.get(voice);
      if (mark === undefined || mark.cuedSeq !== voice.cuedSeq) return undefined;
      const gone = this.dropped.get(subject);
      if (gone !== undefined && gone >= mark.fold) return undefined;
      const a = answers();
      const i = a.index(subject);
      if (i === undefined) return undefined;
      if (!varies(voice as Voice<unknown, unknown>)) return 0;
      const { delays, reach } = a.of(voice);
      return reaches(reach, i) ? (delays?.[i] ?? 0) : undefined;
    };
    this.drop = (subject) => {
      if (answers().index(subject) !== undefined) this.dropped.set(subject, this.folds);
    };
    mix.unheld = this.hook;
    mix.unmet = this.drop;
  }

  /** This frame's folded voices: the CPU would hold a record of each subject they reach from now. */
  mark(voices: readonly Voice<I, unknown>[]): void {
    const fold = ++this.folds;
    for (const v of voices) this.marks.set(v, { fold, cuedSeq: v.cuedSeq });
  }

  /** The subjects were registered again: drops of the old list say nothing of the new. */
  clear(): void {
    this.dropped.clear();
  }

  close(): void {
    if (this.mix.unheld === this.hook) this.mix.unheld = null;
    if (this.mix.unmet === this.drop) this.mix.unmet = null;
    this.dropped.clear();
  }
}
