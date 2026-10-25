import type { Subject } from './voice.js';

/** Whether a record was left at rest during a handover. */
export const isRested = (h: { restedAt: number }): boolean => !Number.isNaN(h.restedAt);

/** A record with every field written out, optional ones too, as every record in a mix is built. */
export type WholeRecord = { [K in Field]: Subject<unknown>[K] };

// Apart, so the mapped type over it keeps no field optional.
type Field = keyof Subject<unknown>;

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
    restedAt: Number.NaN,
    bands: null,
    state,
    // -0, not 0: a field first given a small integer is boxed on every later write of a double.
    stepped: -0,
    ticks: 0,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    rebuilt: 0,
    copied: false,
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
    restored: null,
  } satisfies WholeRecord;
}
