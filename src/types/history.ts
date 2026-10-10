import type { VoiceSpec } from './voice.js';

/**
 * What a mix or transport remembers, for `seek` and `project` to read back: see
 * `MixOptions.history`.
 *
 * @category mix
 */
export interface HistoryOptions {
  /** How much stays in memory, ms of mix time. With a `store`, the rest is paged out, not dropped. */
  ms: number;
  every?: number;
  inputs?: boolean;
  tape?: TapeMaker;
  /**
   * Where history older than `ms` goes instead of being dropped. A `seek` or `project` reaching
   * past memory needs `prepare` first, or throws `HistoryMiss`. With a store, blits never prunes
   * the tape: the host bounds it.
   */
  store?: HistoryStore;
  /** Rebuilds a cued voice's spec from the descriptor it was cued with, so the voice can be paged out. */
  // biome-ignore lint/suspicious/noExplicitAny: a spec of any mix's subjects and pose
  revive?(d: Described): VoiceSpec<any, any>;
}

/**
 * A voice as plain data: `kind` names what built it, and `data` survives `structuredClone`.
 *
 * @category mix
 */
export interface Described {
  kind: string;
  data: unknown;
}

/**
 * Where a history `store` keeps what memory let go of. blits decides what is kept and when it is
 * read back; the store decides where it lives.
 *
 * @category mix
 */
export interface HistoryStore {
  /** Records leaving memory. One brought back by a seek may be paged again: keep one per key and `seq`. */
  page(out: readonly Paged[]): void;
  /**
   * What a restore to mix time `t` needs, for every mix: from each stream, per voice and subject,
   * the latest record at or before `t` and every record after it. Returning everything is fine.
   */
  load(t: number): Promise<readonly Paged[]>;
  /**
   * A seek went back to frame `seq`: every record whose `seq` is greater is from a future the tape
   * makes again. Forget them.
   */
  cut(seq: number): void;
}

/**
 * What a history record holds: a voice's `controls`, a stateful record's `snap`, an `input`
 * signal's reading, a subject's record when it `left` a voice, a motion subject's `released` run
 * or older `stretch`, the `host` fields patches read, a whole `voice` that has left, or the
 * transport's own: a `mark` announced on it, a change of its `pace`, and a `frame` it played.
 *
 * @category mix
 */
export type PagedStream =
  | 'voice'
  | 'snap'
  | 'input'
  | 'left'
  | 'released'
  | 'stretch'
  | 'host'
  | 'controls'
  | 'mark'
  | 'pace'
  | 'frame';

/**
 * One history record leaving memory, as plain data.
 *
 * @category mix
 */
export interface Paged {
  /** The mix's `name`; '' for a mix made alone without one, and for the transport's own records. */
  mix: string;
  stream: PagedStream;
  /** The voice's id, for every stream but `host`. */
  voice?: number;
  /** The subject's key, for a record of one subject; for a `mark`, the number it was announced as. */
  subject?: string | number;
  /** Mix time. */
  at: number;
  /**
   * The transport's frame it was made in. Rate 0 holds mix time still across frames, and a fade
   * given a time already passed is filed behind the frame that decided it, so a cut goes by this.
   */
  seq: number;
  data: unknown;
}

/**
 * One host call a mix recorded on its tape: `apply` makes it again, and `invert` does nothing,
 * since a mix goes back by restoring what it kept rather than by undoing calls.
 *
 * @category mix
 */
export interface TapeOp {
  apply(adapter: unknown): void;
  invert(): TapeOp;
  label?: string;
}

/**
 * One future a tape keeps at its current entry: the calls the host made after the mix last went
 * back here, before it made new ones.
 *
 * @category mix
 */
export interface TapeBranch {
  /** Its first entry's id, which `switchBranch` takes. */
  id: number;
  label: string;
  timestamp: number;
  /** How many entries run along it from here. */
  length: number;
  /** Whether the mix plays it on from here. */
  current: boolean;
}

/**
 * Where a mix keeps the host's calls, by mix time, for `seek`. weasel-history's `History`
 * (`@weasel-js/history`) has this shape. A host reads `branches` and calls `switchBranch` to pick
 * which recorded future plays on; moving it any other way is the mix's job.
 *
 * @category mix
 */
export interface Tape {
  recordEntry(ops: TapeOp[], label: string): void;
  undoDepth(): number;
  timestampAt(i: number): number | undefined;
  depthAt(t: number): number;
  goto(n: number): void;
  redo(): void;
  prune(t: number): void;
  branches(): readonly TapeBranch[];
  switchBranch(id: number): void;
}

/**
 * Makes a mix's tape: weasel-history's `createHistory` is one. The mix passes the clock it stamps
 * calls with, branching on, so a call made after going back keeps the old future as a branch, and
 * coalescing off.
 *
 * @category mix
 */
export type TapeMaker = (
  adapter: unknown,
  opts: { now: () => number; branching: boolean; coalesceWindowMs: number },
) => Tape;
