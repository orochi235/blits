import type { Subject } from './voice.js';

/**
 * A subject's record for `voice` holding every field one can come to hold, in one order, so every
 * record in a mix shares one hidden class: a record built elsewhere, or given `base`, `snaps` or
 * `from` later, took a class of its own, and a fold walking a chain of several kinds reads each
 * field the slow way. The caller sets what it knows; nothing here takes a number, which a call V8
 * does not inline would box.
 */
export function record(voice: object | null, reaches: boolean, state: unknown): Subject<unknown> {
  return {
    reaches,
    delay: 0,
    since: 0,
    shown: 0,
    weight: 0,
    rested: false,
    bands: null,
    state,
    stepped: 0,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    rebuilt: 0,
    base: undefined,
    slope: undefined,
    kept: null,
    unkept: undefined,
    snaps: undefined,
    from: undefined,
    unknown: undefined,
    inputs: undefined,
    replay: undefined,
    voice,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
    run: -1,
    freed: -1,
  };
}
