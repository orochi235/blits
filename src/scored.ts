import type { Mixer } from './mixer.js';
import type { Voice } from './voice.js';

/**
 * A mix's voices, cued and gone, by the score they were cued on, for an anchor that asks for a
 * score's marks. Without it every such anchor read every voice of every mix on the transport each
 * frame, the thousands history keeps among them. Built over the lists it saw: a seek or a copy that
 * replaces either one rebuilds it on the next read.
 */
export class ScoreIndex<I, O> {
  cued: readonly Voice<I, O>[] | null = null;
  gone: readonly Voice<I, O>[] | null = null;
  by = new Map<string, Set<Voice<I, O>>>();
}

function put<I, O>(by: Map<string, Set<Voice<I, O>>>, voice: Voice<I, O>): void {
  const score = voice.spec.score;
  if (score === undefined) return;
  const set = by.get(score);
  if (set === undefined) by.set(score, new Set([voice]));
  else set.add(voice);
}

/** The voices of `mix` cued on `score`, cued and gone, in no order. */
export function scored<I, O>(mix: Mixer<I, O>, score: string): Iterable<Voice<I, O>> {
  const ix = mix.scored;
  if (ix.cued !== mix.cued || ix.gone !== mix.gone) {
    ix.by = new Map();
    for (const v of mix.cued) put(ix.by, v);
    for (const v of mix.gone) put(ix.by, v);
    ix.cued = mix.cued;
    ix.gone = mix.gone;
  }
  return ix.by.get(score) ?? [];
}

/** A voice now in `cued` or `gone` that was in neither. */
export function scoredAdd<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const ix = mix.scored;
  if (ix.cued === mix.cued && ix.gone === mix.gone) put(ix.by, voice);
}

/** Voices now in neither list. */
export function scoredRemove<I, O>(mix: Mixer<I, O>, voices: Iterable<Voice<I, O>>): void {
  const ix = mix.scored;
  if (ix.cued !== mix.cued || ix.gone !== mix.gone) return;
  for (const v of voices) {
    const score = v.spec.score;
    if (score === undefined) continue;
    const set = ix.by.get(score);
    if (set === undefined) continue;
    set.delete(v);
    if (set.size === 0) ix.by.delete(score);
  }
}
