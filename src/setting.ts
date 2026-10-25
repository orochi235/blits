import { reading } from './reading.js';
import type { Setting } from './types.js';
import type { Voice } from './voice.js';

/**
 * A voice's `setting.keep`, one per voice: a setting is valid only during its call, so the state
 * goes on the record of the subject being called for, `keepOn`, or on the voice before any is.
 */
export function keeping<I, O>(voice: Voice<I, O>): Setting['keep'] {
  return function keep<K>(owner: object, init: () => K): K {
    const held = voice.keepOn;
    let kept = held === null ? voice.ownKept : held.kept;
    if (kept === null) {
      kept = new Map();
      if (held === null) voice.ownKept = kept;
      else held.kept = kept;
    }
    if (kept.has(owner)) return kept.get(owner) as K;
    const unkept = held?.unkept;
    const made = unkept === undefined ? init() : (unkept.shift() as K);
    if (unkept?.length === 0 && held !== null) held.unkept = undefined;
    kept.set(owner, made);
    reading.kept++;
    return made;
  };
}

/**
 * A voice's setting. `keep` is made on first read: most patches keep no state, and a closure and
 * its context per voice cost a one-subject tween voice about 100 bytes.
 */
export class VoiceSetting<I, O> implements Setting<unknown> {
  timestamp = 0;
  dt = 0;
  elapsed = 0;
  pass = 0;
  weight = 0;
  state: unknown = undefined;
  /** The `Arg.MARK` a lane last filled `timestamp`, `elapsed` and `pass` under; 0 once anything else writes them. */
  mark = 0;
  private kept: Setting['keep'] | null = null;

  constructor(
    public host: unknown,
    readonly send: (event: unknown) => void,
    private readonly voice: Voice<I, O>,
  ) {}

  get keep(): Setting['keep'] {
    if (this.kept === null) this.kept = keeping(this.voice);
    return this.kept;
  }
}
