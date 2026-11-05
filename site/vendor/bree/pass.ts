import type { Stop, Stretch } from './effects.js';
import type { Slot } from './moves/index.js';
import type { StagedScene } from './program.js';

/** One scene of a pass: which scene of the program it is, and where it and its parts play, ms. */
export interface PassScene {
  readonly scene: number;
  readonly start: number;
  readonly ms: number;
  readonly parts: Readonly<Record<Slot, Stretch>>;
}

/**
 * Where the pass playing now stands: ms into it, how long it is, its scenes end to end, and
 * whether it is waiting for input at a rest.
 */
export interface Pass {
  readonly at: number;
  readonly waiting: boolean;
  readonly length: number;
  readonly scenes: readonly PassScene[];
}

/**
 * Staged scenes laid end to end, numbered by their place in the program, `offset` scenes in, and
 * where the pass waits for input.
 */
export function layOut(
  staged: readonly StagedScene[],
  offset: number,
): { scenes: PassScene[]; length: number; stops: Stop[] } {
  let start = 0;
  const stops: Stop[] = [];
  const scenes = staged.map((s) => {
    const at = start;
    const parts = Object.fromEntries(
      Object.entries(s.staged.parts).map(([slot, p]) => [slot, { start: at + p.start, ms: p.ms }]),
    ) as Record<Slot, Stretch>;
    const out = { scene: s.scene + offset, start, ms: s.staged.ms, parts };
    for (const stop of s.staged.stops) stops.push({ ...stop, at: at + stop.at });
    start += s.staged.ms;
    return out;
  });
  return { scenes, length: start, stops };
}

/**
 * A pass's own clock, read off the mix clock: where the pass stood at mix time `mix`, and how fast
 * it moves from there. Before the mix's first sync `mix` is NaN, and `settle` fixes it at that sync.
 */
export class PassClock {
  private mix = Number.NaN;
  private at = 0;
  private rate = 1;

  /** The pass is at `at` at mix time `now`, moving at `rate` from there. */
  set(now: number, at = 0, rate = 1): void {
    this.mix = now;
    this.at = at;
    this.rate = rate;
  }

  /** A pass set before the mix's first sync starts at it. */
  settle(now: number): void {
    if (Number.isNaN(this.mix)) this.mix = now;
  }

  read(now: number): number {
    return Number.isNaN(this.mix) ? this.at : this.at + (now - this.mix) * this.rate;
  }
}
