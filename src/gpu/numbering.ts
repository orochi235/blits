import type { Motions } from '../motions.js';
import { absent } from '../numbers.js';
import type { Segment } from '../stretch.js';

/** A run the patch has not made: a subject's first stretch, and its flags. */
export interface Unmet {
  readonly seg: Segment;
  readonly flags: number;
}

/**
 * Which of a patch's subject numbers each registered subject's row holds. A subject the patch has
 * not met gets the first stretch it would have, without the patch numbering it: registering is
 * not meeting.
 */
export class Numbering<I> {
  /** By row, the subject's number in `motions`; -1 for one the patch has not met. */
  readonly slots: Int32Array;
  /** By row, an unmet subject's first stretch; undefined for a met one, or one not worked out yet. */
  private readonly unmet: (Unmet | undefined)[] = [];
  /** By subject number, its row; undefined for a number not yet matched to a registered subject. */
  private readonly rowOf: (number | undefined)[] = [];
  private readonly bySubject = new Map<I, number>();

  constructor(
    private readonly motions: Motions<I>,
    private readonly list: readonly I[],
  ) {
    this.slots = new Int32Array(list.length).fill(-1);
    list.forEach((subject, i) => {
      this.bySubject.set(subject, i);
      const s = motions.known(subject);
      if (s === undefined) {
        const run = motions.freshRun(subject);
        this.unmet[i] = { seg: run.stretches[0] as Segment, flags: run.flags };
        return;
      }
      this.slots[i] = s;
      this.rowOf[s] = i;
    });
  }

  /** Subject number `s`'s row, matching it to its registered subject the first time it is seen. */
  rowFor(s: number): number | undefined {
    const known = this.rowOf[s];
    if (known !== undefined) return known;
    const subject = this.motions.numbers.subject(s);
    if (subject === absent) return undefined;
    const row = this.bySubject.get(subject);
    if (row === undefined) return undefined;
    this.slots[row] = s;
    this.rowOf[s] = row;
    this.unmet[row] = undefined;
    return row;
  }

  /** Lets go of number `s` where the patch gave it up or to another subject; its row, if so. */
  recheck(s: number): number | undefined {
    const row = this.rowOf[s];
    if (row === undefined) return undefined;
    const now = this.motions.numbers.subject(s);
    if (now !== absent && Object.is(now, this.list[row])) return undefined;
    this.rowOf[s] = undefined;
    this.slots[row] = -1;
    this.unmet[row] = undefined;
    return row;
  }

  /** Unmet row `row`'s first stretch, worked out the first time it is asked. */
  unmetAt(row: number): Unmet {
    let u = this.unmet[row];
    if (u === undefined) {
      const run = this.motions.freshRun(this.list[row] as I);
      u = { seg: run.stretches[0] as Segment, flags: run.flags };
      this.unmet[row] = u;
    }
    return u;
  }

  /** Row `row`'s release time, voice ms; undefined for an unmet one not worked out yet. */
  releaseAt(row: number): number | undefined {
    const s = this.slots[row] as number;
    if (s >= 0) return this.motions.runs[this.motions.base(s)] as number;
    return this.unmet[row]?.seg.at;
  }
}
