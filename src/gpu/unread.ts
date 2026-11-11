import { silent, weighed } from '../clock.js';
import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import type { Timings } from './timings.js';
import { type Weighs, weighsOf } from './weight.js';

/** Whether a voice's reach mask, null for every subject, holds registered subject `row`. */
export const reaches = (reach: Uint32Array | null, row: number): boolean =>
  reach === null || (((reach[row >>> 5] as number) >>> (row & 31)) & 1) === 1;

/**
 * Whether a live read this frame leaves a motion voice's registered subject `row` unsampled, so its
 * changes uncommitted, as `contribution` and a lane do: the voice does not reach it, or its weight
 * there is silent. Each subject's weight is the one the kernel folds it at.
 */
export function unreadOf<I>(
  mix: Mixer<I, unknown>,
  voice: Voice<I, unknown>,
  answers: Answers<I>,
  timings: Timings,
  /** The voice's per-subject weight reads, by registration order; null where it has none. */
  reads: Float32Array | null = null,
  weigh: Weighs = weighsOf(mix, voice),
): (row: number) => boolean {
  const now = mix.now;
  const answer = varies(voice as Voice<unknown, unknown>) ? answers.of(voice) : null;
  const reach = answer?.reach ?? null;
  // Staggered and fading in, each subject fades in from its own origin, which its timing block keeps.
  const own = (answer?.delays ?? null) !== null && (voice.fade.in ?? 0) > 0;
  const origins = own ? timings.originsOf(mix, voice, answers) : null;
  return (row) => {
    if (!reaches(reach, row)) return true;
    const owned = own
      ? mix.envelope(voice, now, origins === null ? Number.NaN : origins(row)) * weigh.owned
      : weigh.faded;
    const read = reads?.[row];
    return silent(voice, weighed(read === undefined ? weigh.base : read * weigh.base, owned, 1));
  };
}
