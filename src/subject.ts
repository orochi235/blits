import type { Stamp } from './restored.js';

/**
 * A subject's record as it left a voice, faded out of it or dropped: the mix time and frame it
 * left at, and `sync` where it shows in its own frame: left in the frame's sync, or before anything
 * read the mix that frame.
 */
export interface Left<I> {
  subject: I;
  at: number;
  seq: number;
  sync: boolean;
  held: Subject<unknown>;
  /**
   * The voice's fade of the subject as it stood on leaving, which a seek or read back to before
   * puts back: its ramp out, while running, or its having faded out.
   */
  ramp: Parting | null;
  parted: Parted | null;
}

/** A subject's ramp out of one voice: when it began, how long it runs, and the frame it was asked in. */
export interface Parting {
  at: number;
  over: number;
  seq: number;
}

export interface Parted {
  at: number;
  seq: number;
  ramp: Parting | undefined;
}

/**
 * What a copy of a record keeps for the seeks that put a record back from it: the copy's state
 * stepped on to `ticks`, as it stood near `at`, a moment one of them sought.
 */
export interface Ahead<S> {
  /** The record the last seek put back, and the moment it sought, until that record steps. */
  put: Subject<S> | null;
  sought: number;
  /** The `since` of the record put back, which the steps in `state` were counted from. */
  since: number;
  at: number;
  ticks: number;
  /** Undefined until a record has stepped on from the copy. */
  state: S | undefined;
  /**
   * The state the record a seek replaced had stepped on to from the copy, at `leftTicks`; undefined
   * until one had.
   */
  leftTicks: number;
  left: S | undefined;
}

/** A copy of a record kept under `history`, by the mix time and frame it was taken at. */
export interface Snap<S> {
  at: number;
  seq: number;
  held: Subject<S>;
  ahead?: Ahead<S>;
  /** Set where another record's list holds it too, so a seek cutting it from one lets go of it. */
  shared?: true;
}

/** Everything one voice holds for one subject, chained through the next voice that reaches it. */
export interface Subject<S> {
  /** The voice's `target` answer, fixed on first sight. */
  reaches: boolean;
  /** The voice's `stagger` answer in voice ms, fixed on first sight. */
  delay: number;
  /** The mix timestamp this subject's delay ran out at, which its step grid counts from. */
  since: number;
  /** The mix timestamp its fade in counts from: `since`, or earlier for a voice freezing before. */
  shown: number;
  /** The weight this voice gave this subject the last frame it was probed, 0 where it gave none. */
  weight: number;
  /**
   * The mix time it was left at rest during a handover, so it stops contributing, and which a seek
   * reads to know whether it had by then; NaN while it has not (`isRested`).
   */
  restedAt: number;
  /**
   * Per written channel, whether a rest-less contribution is on: 0 unknown, 1 on, 2 off; null until
   * a rest-less channel asks.
   */
  bands: Uint8Array | null;
  state: S;
  /** The `now` this subject last caught up to, for this voice. */
  stepped: number;
  /** Under `stepMs`, how many intervals have run since `since`; `stepped` is where that lands. */
  ticks: number;
  /** The `now` this subject was last probed at, so twelve probes in a frame step once. */
  probed: number;
  /** The last delta computed this frame, handed back to a repeat probe unchanged. */
  delta: Record<string, unknown> | null;
  /** The phase `delta` was read at, to read it again once its voice's scratch has moved on. */
  phase: number;
  /** The voice's `seeks` when `delta` was read, so a seek later in the frame reads it again. */
  seeks: number;
  /** The voice's `rebuilds` when its state was last made, so a seek's rebuild reaches it once. */
  rebuilt: number;
  /** Its kept signal state was stepped on in one go from a copy history kept, by a seek. */
  copied: boolean;
  /** Stop 0 for a `from: 'current'` voice, taken the first frame this subject is seen. */
  base?: Record<string, unknown>;
  /** The pose's velocity per channel at that moment, units per ms, so the first segment leaves at it. */
  slope?: Record<string, unknown>;
  /** What `setting.keep` holds for this voice and subject, by owner; null until it holds any. */
  kept: Map<object, unknown> | null;
  /** Kept state a history store gave back, which each owner takes in turn on its first keep. */
  unkept?: unknown[];
  /** Under `history`, copies of this record by the mix time they were taken, oldest first. */
  snaps?: Snap<S>[];
  /** In a projection: where this record started from, and whether nothing known could be. */
  from?: number;
  unknown?: boolean;
  /** Under `history` with `inputs`, what an input weight signal read for this subject, when it changed. */
  inputs?: { at: number; seq: number; value: number }[];
  /** In a projection reading back: that record, to read in place of the signal. */
  replay?: { at: number; value: number }[];
  /** The voice this is the record of; null on a subject's stub. */
  voice: object | null;
  /** The next voice's record for this subject, in voice order, among those that reach it. */
  next: Subject<unknown> | null;
  /**
   * On the first record, which the mix keeps per subject so a probe makes one lookup: the `version`
   * the chain was linked at, and per role, by channel slot, whether a rest-less contribution is on:
   * 0 never decided, 1 on, 2 off.
   */
  version: number;
  roles: Map<string, Uint8Array> | null;
  /** On the first record: the number lanes index this subject by, -1 without one. */
  slot: number;
  /** A motion voice's number for this subject in its patch, good while `freed` is the patch's own. */
  run: number;
  freed: number;
  /** In a voice's store once a seek has gone back, the stamp of the seek it was last put back or written at. */
  restored: Stamp | null;
}
