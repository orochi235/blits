import type { Crowd } from './crowd.js';
import type { Voice } from './voice.js';

/**
 * A crowd voice's row, held on the voice and by its id in its lanes' `seats`: one place to read
 * both its crowd and its row, where two maps by id were two cache misses a stop at 40,000 voices.
 * `lanes` is the lanes it was given in, null once they let it go.
 */
export class Seat<I, O> {
  constructor(
    public lanes: object | null,
    readonly crowd: Crowd<I, O>,
    public row: number,
  ) {}
}

/** `voice`'s seat in `lanes`, null where it has none there. */
export function seatOf<I, O>(lanes: object, voice: Voice<I, O>): Seat<I, O> | null {
  const s = voice.seat;
  return s !== null && s.lanes === lanes ? s : null;
}

/** Whether row `p` of `c` is `voice`'s seat in `lanes`, not a row it has left. */
export function seated<I, O>(
  lanes: object,
  voice: Voice<I, O>,
  c: Crowd<I, O>,
  p: number,
): boolean {
  const s = seatOf(lanes, voice);
  return s !== null && s.crowd === c && s.row === p;
}
