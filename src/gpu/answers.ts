import type { Asked } from '../asked.js';
import type { Mixer } from '../mixer.js';
import { Store } from '../store.js';
import type { Voice } from '../voice.js';

/** A voice's `stagger` and `target` answers for the registered subjects, in registration order. */
export interface Answer {
  /** Each registered subject's delay, registration order; null where the voice does not stagger. */
  readonly delays: Float64Array | null;
  /** One bit per registered subject, set where reached; null where every one is reached. */
  readonly reach: Uint32Array | null;
  /** Whether every delay of a reached subject is a finite number. */
  readonly finite: boolean;
}

/**
 * The gpu side's table of `stagger` and `target` answers: each asked once per voice per subject,
 * and handed to the voice's `asked` so the CPU takes them rather than asking again.
 */
export class Answers<I> {
  private list: readonly I[] = [];
  private at = new Map<I, number>();
  private made = new WeakMap<Voice<I, unknown>, Answer>();
  /** Per voice over no named list, each subject answered: its delay where reached, else null. */
  private readonly known = new WeakMap<Voice<I, unknown>, Store<I, number | null>>();

  constructor(readonly mix: Mixer<I, unknown>) {}

  /** Forgets every answer and indexes `list`; each voice is asked again at its next `of`. */
  register(list: readonly I[]): void {
    this.list = list;
    // A new map, not a cleared one: each voice's hook keeps reading the index its arrays were made by.
    const at = new Map<I, number>();
    list.forEach((s, i) => {
      if (!at.has(s)) at.set(s, i);
    });
    this.at = at;
    this.made = new WeakMap();
  }

  /** The voice's answers for the registered list, made once per voice per `register`. */
  of(voice: Voice<I, unknown>): Answer {
    const had = this.made.get(voice);
    if (had !== undefined) return had;
    const answer = this.answer(voice);
    this.made.set(voice, answer);
    const { stagger, target } = voice.spec;
    if (voice.named === null && (stagger !== undefined || target !== undefined))
      voice.asked = askedOf(this.at, answer);
    return answer;
  }

  /** A registered subject's place in the list. */
  index(subject: I): number | undefined {
    return this.at.get(subject);
  }

  private answer(voice: Voice<I, unknown>): Answer {
    const list = this.list;
    const n = list.length;
    const { named } = voice;
    const { stagger, target } = voice.spec;
    const delays = stagger !== undefined ? new Float64Array(n) : null;
    const bits = new Uint32Array((n + 31) >>> 5);
    let all = true;
    let finite = true;
    let known: Store<I, number | null> | undefined;
    if (named === null) {
      known = this.known.get(voice);
      if (known === undefined) {
        known = new Store();
        this.known.set(voice, known);
      }
    }
    for (let i = 0; i < n; i++) {
      const s = list[i] as I;
      let reaches: boolean;
      let delay = 0;
      const held = voice.subjects.get(s);
      if (held !== undefined) {
        reaches = held.reaches;
        if (reaches) delay = held.delay;
        known?.set(s, reaches ? delay : null);
      } else if (named !== null) {
        reaches = named.has(s);
        if (reaches) delay = named.delays?.get(s) ?? 0;
      } else {
        const k = (known as Store<I, number | null>).get(s);
        if (k !== undefined) {
          reaches = k !== null;
          delay = k ?? 0;
        } else {
          reaches = target ? target(s) : true;
          if (reaches && stagger) delay = stagger(s);
          (known as Store<I, number | null>).set(s, reaches ? delay : null);
        }
      }
      if (!reaches) {
        all = false;
        continue;
      }
      bits[i >>> 5] = (bits[i >>> 5] as number) | (1 << (i & 31));
      if (delays !== null) {
        delays[i] = delay;
        if (!Number.isFinite(delay)) finite = false;
      }
    }
    return { delays, reach: all ? null : bits, finite };
  }
}

/** The hook reading `answer` through `at`, the index its arrays were made by. */
function askedOf<I>(at: Map<I, number>, answer: Answer): Asked<I> {
  const { delays, reach } = answer;
  const reached = (i: number) =>
    reach === null || (((reach[i >>> 5] as number) >>> (i & 31)) & 1) === 1;
  return {
    delay(subject) {
      const i = at.get(subject);
      return delays === null || i === undefined || !reached(i) ? undefined : delays[i];
    },
    reaches(subject) {
      const i = at.get(subject);
      return i === undefined ? undefined : reached(i);
    },
  };
}
