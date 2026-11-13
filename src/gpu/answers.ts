import type { Asked } from '../asked.js';
import { headOf } from '../chain.js';
import { meet } from '../delay.js';
import type { Mixer } from '../mixer.js';
import type { Named } from '../named.js';
import { Store } from '../store.js';
import { unreached } from '../unreached.js';
import type { Voice } from '../voice.js';

/** A voice's `stagger` and `target` answers for the registered subjects, in registration order. */
export interface Answer {
  /** Each registered subject's delay, registration order; null where the voice does not stagger. Never written: it may be the voice's `Named.ordered`. */
  readonly delays: Float64Array | null;
  /** One bit per registered subject, set where reached; null where every one is reached. */
  readonly reach: Uint32Array | null;
  /** Whether every delay of a reached subject is a finite number. */
  readonly finite: boolean;
}

/**
 * Whether a voice's delays or reach can differ by subject: it staggers, has a `target`, or names its
 * subjects. One that does none of these reaches every subject at delay 0, with nothing to ask.
 */
export function varies(voice: Voice<unknown, unknown>): boolean {
  const { stagger, target } = voice.spec;
  return stagger !== undefined || target !== undefined || voice.named !== null;
}

/**
 * The gpu side's table of `stagger` and `target` answers: each asked once per voice per subject,
 * and handed to the voice's `asked` so the CPU takes them rather than asking again.
 */
export class Answers<I> {
  private list: readonly I[] = [];
  private at = new Map<I, number>();
  private made = new WeakMap<Voice<I, unknown>, Answer>();
  /** Per named list, or the list of the group filing it, whether it is `list` in order. */
  private inOrders = new WeakMap<readonly unknown[], boolean>();
  /** Per voice over no named list, each subject answered: its delay where reached, else null. */
  private readonly known = new WeakMap<Voice<I, unknown>, Store<I, number | null>>();
  /** Seeks back the mix has made, and per voice, how many when its answers were last made. */
  private backs = 0;
  private readonly madeAt = new WeakMap<Voice<I, unknown>, number>();

  constructor(private readonly mix: Mixer<I, unknown>) {}

  /**
   * Indexes `list`; each voice's arrays are made again at its next `of`, asking only subjects it
   * has never answered for that voice.
   */
  register(list: readonly I[]): void {
    this.list = list;
    // A new map, not a cleared one: each voice's hook keeps reading the index its arrays were made by.
    const at = new Map<I, number>();
    list.forEach((s, i) => {
      if (!at.has(s)) at.set(s, i);
    });
    this.at = at;
    this.made = new WeakMap();
    this.inOrders = new WeakMap();
  }

  /**
   * A seek back: each voice's arrays are made again at its next `of`, its delays taken as the
   * voice's kept answers give them where it stood, so a replay asks nothing the live mix did not.
   */
  back(): void {
    this.backs++;
    this.made = new WeakMap();
  }

  /** Forgets `voice`'s answer for `subject`, so its next `of` asks for it afresh. */
  forget(voice: Voice<I, unknown>, subject: I): void {
    const known = this.known.get(voice);
    if (known === undefined || known.get(subject) === undefined) return;
    known.delete(subject);
    this.made.delete(voice);
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

  /**
   * Whether `named` is the registered list, subject for subject: asked once for all the voices the
   * mix's index files in one group, which name the same list.
   */
  private inOrder(voice: Voice<I, unknown>, named: readonly I[]): boolean {
    const key = voice.group?.list ?? named;
    let known = this.inOrders.get(key);
    if (known === undefined) {
      known = inOrder(this.list, named);
      this.inOrders.set(key, known);
    }
    return known;
  }

  /** A registered subject's place in the list. */
  index(subject: I): number | undefined {
    return this.at.get(subject);
  }

  private answer(voice: Voice<I, unknown>): Answer {
    const list = this.list;
    const n = list.length;
    const { named } = voice;
    if (named !== null && this.inOrder(voice, named.list)) return whole(named);
    const delays = voice.spec.stagger !== undefined ? new Float64Array(n) : null;
    const bits = new Uint32Array((n + 31) >>> 5);
    let all = true;
    let finite = true;
    let known = this.known.get(voice);
    if (named === null && known === undefined) {
      known = new Store();
      this.known.set(voice, known);
    }
    const sought = voice.staggers !== null && (this.madeAt.get(voice) ?? this.backs) < this.backs;
    this.madeAt.set(voice, this.backs);
    for (let i = 0; i < n; i++) {
      const s = list[i] as I;
      let delay: number | null;
      if (named !== null) delay = named.has(s) ? (named.delays?.get(s) ?? 0) : null;
      else delay = this.unnamed(voice, s, known as Store<I, number | null>, sought);
      if (delay === null) {
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

  /**
   * A subject's answer for a voice over no named list, its delay where `target` reaches it and
   * null where not: from what the voice already holds, else asked, and kept either way. After a
   * seek back (`sought`), a delay held is met again, as the voice's kept answers give it.
   */
  private unnamed(
    voice: Voice<I, unknown>,
    s: I,
    known: Store<I, number | null>,
    sought: boolean,
  ): number | null {
    const k = known.get(s);
    if (k === null || (k !== undefined && !sought)) return k;
    if (k !== undefined) {
      const held = voice.subjects.get(s);
      const met = held?.reaches ? held.delay : meet(this.mix, voice, s, staggerOf, k);
      known.set(s, met);
      return met;
    }
    // A subject faded out is held unreached, which says nothing of what `target` answered.
    const parted = voice.parted?.has(s) === true;
    const held = voice.subjects.get(s);
    let answer: number | null;
    if (held !== undefined && (held.reaches || !parted)) answer = held.reaches ? held.delay : null;
    else if (!parted && unreached(voice, headOf(this.mix, s)?.slot ?? -1)) answer = null;
    else {
      const { target, stagger } = voice.spec;
      const reaches = target ? target(s) : true;
      answer = !reaches ? null : stagger ? meet(this.mix, voice, s, staggerOf) : 0;
    }
    known.set(s, answer);
    return answer;
  }
}

/** The voice's `stagger` asked, never a gpu side's table, which may still hold an answer let go. */
function staggerOf<I>(voice: Voice<I, unknown>, s: I): number {
  return (voice.spec.stagger as (s: I) => number)(s);
}

/** Whether `named` is `list`, subject for subject, as a host naming every subject it registered has it. */
function inOrder<I>(list: readonly I[], named: readonly I[]): boolean {
  const n = list.length;
  if (named.length !== n) return false;
  for (let i = 0; i < n; i++) if (list[i] !== named[i]) return false;
  return true;
}

/** The answer of a voice naming every registered subject in order, delayed by `ordered`. */
function whole(named: Named<unknown>): Answer {
  const { ordered, finite } = named;
  return { delays: ordered, reach: null, finite };
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
