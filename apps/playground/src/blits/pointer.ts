import type { Circle, Easing, Mix, Signal } from '@msb235/blits';
import type { Composition, StageSpec } from './composition';
import { bare } from './expr';
import type { Mixed } from './kit';
import type { Subject } from './stage';

/** Where the stage's pointer is, in dots: `x` by column, `y` by row. Every `around` circle follows it. */
export class Pointer {
  readonly circles: Circle[] = [];

  constructor(
    public x: number,
    public y: number,
  ) {}

  static centerOf(stage: StageSpec): Pointer {
    return stage.kind === 'dots'
      ? new Pointer((stage.cols - 1) / 2, (stage.rows - 1) / 2)
      : new Pointer(([...stage.text].length - 1) / 2, 0);
  }

  move(x: number, y: number): void {
    this.x = x;
    this.y = y;
    for (const c of this.circles) {
      c.x = x;
      c.y = y;
    }
  }

  /** The scope's `around` for mix `m`: its signal over a circle of `r` dots on the pointer. */
  aroundIn(m: Mix<Subject, Mixed>): (r: number, opts?: { ease?: Easing }) => Signal<Subject> {
    return (r, opts = {}) => {
      if (!(r > 0)) throw new RangeError(`around takes a radius above 0, not ${r}`);
      const circle = { x: this.x, y: this.y, r };
      this.circles.push(circle);
      const signal = m.around(circle, opts);
      bare.add(signal);
      return signal;
    };
  }
}

/**
 * Whether the composition's code calls `around`. Its mixes then keep no history, which blits refuses
 * a bounded voice, so a scrub back replays rather than seeks.
 */
export const usesAround = (c: Composition): boolean => /\bnear\s*\(/.test(JSON.stringify(c));

/** Each subject's position for `plot`, in dots: column, then row. */
export const xyOf = (subjects: readonly Subject[]): Float64Array =>
  new Float64Array(subjects.flatMap((s) => [s.col, s.row]));
