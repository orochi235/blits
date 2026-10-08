import type { Mixer } from './mixer.js';
import type { Voice } from './voice.js';

/**
 * A mix's voices by the score they were cued on, for an anchor that asks for a score's marks: the
 * cued ones as a set, the gone ones in the order they left, which an anchor reads once each. Built
 * over the lists it saw: a seek or a copy that replaces either rebuilds that half on the next read.
 * A score whose gone voices history lets go of gets a fresh list, so a read of the old one starts
 * over.
 */
export class ScoreIndex<I, O> {
  cued: readonly Voice<I, O>[] | null = null;
  by = new Map<string, Set<Voice<I, O>>>();
  gone: readonly Voice<I, O>[] | null = null;
  goneBy = new Map<string, Voice<I, O>[]>();
  /** Bumped for a score each time a voice on it is cued, retimed, retired or leaves. */
  versions = new Map<string, number>();
  /** The scores whose list on the transport names this mix. */
  held = new Set<string>();
}

type Member = Mixer<unknown, unknown>;

/**
 * Per score, the mixes on a transport that may hold a voice on it, cued or gone, in the
 * transport's order. Never short of one that does; one found holding none is let go on that read.
 */
export type ScoreHolders = Map<string, Member[]>;

function hold<I, O>(mix: Mixer<I, O>, score: string): void {
  const held = mix.scored.held;
  // A dropped mix is off the transport's lists until a seek puts it back, and `scoredJoin` then.
  if (held.has(score) || mix.dropped) return;
  held.add(score);
  const by = mix.transport.holders;
  const m = mix as unknown as Member;
  const list = by.get(score);
  if (list === undefined) {
    by.set(score, [m]);
    return;
  }
  const i = list.findIndex((o) => o.slot > m.slot);
  if (i < 0) list.push(m);
  else list.splice(i, 0, m);
}

/** The mixes on `mix`'s transport that may hold a voice on `score`; the list is the transport's own. */
export function holders<I, O>(mix: Mixer<I, O>, score: string): readonly Mixer<I, O>[] {
  return (mix.transport.holders.get(score) ?? none) as unknown as readonly Mixer<I, O>[];
}

/** Takes `mix` off `score`'s list, having found it holds nothing there. */
export function unhold<I, O>(mix: Mixer<I, O>, score: string): void {
  mix.scored.held.delete(score);
  const by = mix.transport.holders;
  const list = by.get(score);
  if (list === undefined) return;
  const i = list.indexOf(mix as unknown as Member);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) by.delete(score);
}

/** A mix joining its transport, with whatever voices it already has. */
export function scoredJoin<I, O>(mix: Mixer<I, O>): void {
  for (const v of mix.cued) if (v.spec.score !== undefined) hold(mix, v.spec.score);
  for (const v of mix.gone) if (v.spec.score !== undefined) hold(mix, v.spec.score);
}

/** A mix leaving its transport. */
export function scoredDrop<I, O>(mix: Mixer<I, O>): void {
  for (const score of [...mix.scored.held]) unhold(mix, score);
}

/**
 * A voice on its score was cued, retimed, retired or left: what was read of the score is stale. A
 * host can still retime a gone voice through a handle it kept, so `retimed` on a done voice
 * replaces its score's gone list too, which starts every read of it over.
 */
export function scoreTouched<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, retimed = false): void {
  const score = voice.spec.score;
  if (score === undefined) return;
  const ix = mix.scored;
  ix.versions.set(score, (ix.versions.get(score) ?? 0) + 1);
  if (!retimed || voice.state !== 'done') return;
  const gone = ix.goneBy.get(score);
  if (gone !== undefined) ix.goneBy.set(score, [...gone]);
}

/** How many times `score` has been touched in `mix`. */
export function scoreVersion<I, O>(mix: Mixer<I, O>, score: string): number {
  return mix.scored.versions.get(score) ?? 0;
}

function put<I, O>(by: Map<string, Set<Voice<I, O>>>, voice: Voice<I, O>): void {
  const score = voice.spec.score;
  if (score === undefined) return;
  const set = by.get(score);
  if (set === undefined) by.set(score, new Set([voice]));
  else set.add(voice);
}

/** The voices of `mix` cued on `score` and not yet gone, in no order. */
export function scored<I, O>(mix: Mixer<I, O>, score: string): ReadonlySet<Voice<I, O>> {
  const ix = mix.scored;
  if (ix.cued !== mix.cued) {
    ix.by = new Map();
    for (const v of mix.cued) put(ix.by, v);
    ix.cued = mix.cued;
  }
  return ix.by.get(score) ?? noVoices;
}

const noVoices: ReadonlySet<never> = new Set();

/** The voices of `mix` cued on `score` that have gone, in the order they left. */
export function scoredGone<I, O>(mix: Mixer<I, O>, score: string): readonly Voice<I, O>[] {
  const ix = mix.scored;
  if (ix.gone !== mix.gone) {
    ix.goneBy = new Map();
    for (const v of mix.gone) goneAdd(ix.goneBy, v);
    ix.gone = mix.gone;
  }
  return ix.goneBy.get(score) ?? none;
}

const none: readonly never[] = [];

function goneAdd<I, O>(by: Map<string, Voice<I, O>[]>, voice: Voice<I, O>): void {
  const score = voice.spec.score;
  if (score === undefined) return;
  const list = by.get(score);
  if (list === undefined) by.set(score, [voice]);
  else list.push(voice);
}

/** A voice just pushed onto `gone`. */
export function scoredLeft<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (voice.spec.score !== undefined) hold(mix, voice.spec.score);
  const ix = mix.scored;
  if (ix.gone === mix.gone) goneAdd(ix.goneBy, voice);
}

/**
 * Gone voices history let go of, out of `was`; `mix.gone` is already what is left, whether that
 * is `was` cut in place or a new list.
 */
export function scoredCut<I, O>(
  mix: Mixer<I, O>,
  was: readonly Voice<I, O>[],
  out: readonly Voice<I, O>[],
): void {
  const ix = mix.scored;
  if (ix.gone !== was) return;
  ix.gone = mix.gone;
  const by = new Map<string, Set<Voice<I, O>>>();
  for (const v of out) {
    const score = v.spec.score;
    if (score === undefined) continue;
    const set = by.get(score);
    if (set === undefined) by.set(score, new Set([v]));
    else set.add(v);
  }
  for (const [score, gone] of by) {
    const left = (ix.goneBy.get(score) ?? []).filter((v) => !gone.has(v));
    if (left.length === 0) ix.goneBy.delete(score);
    else ix.goneBy.set(score, left);
  }
}

/** A voice just cued. */
export function scoredAdd<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  scoreTouched(mix, voice);
  if (voice.spec.score !== undefined) hold(mix, voice.spec.score);
  const ix = mix.scored;
  if (ix.cued === mix.cued) put(ix.by, voice);
}

/** Voices no longer cued. */
export function scoredRemove<I, O>(mix: Mixer<I, O>, voices: Iterable<Voice<I, O>>): void {
  for (const v of voices) scoreTouched(mix, v);
  const ix = mix.scored;
  if (ix.cued !== mix.cued) return;
  for (const v of voices) {
    const score = v.spec.score;
    if (score === undefined) continue;
    const set = ix.by.get(score);
    if (set === undefined) continue;
    set.delete(v);
    if (set.size === 0) ix.by.delete(score);
  }
}
