import { index, unindex } from './chain.js';
import { detour } from './everyone.js';
import type { Mixer } from './mixer.js';
import { Store } from './store.js';
import type { Voice } from './voice.js';

function tally<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, by: 1 | -1): void {
  if (voice.spec.locus !== undefined) mix.loci += by;
  if (voice.spec.anchor !== undefined) mix.anchored += by;
}

/** Counts a voice just put in the list into everything a sync and a fold skip work by. */
export function enlist<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (voice.holding !== null) {
    mix.owners ??= [];
    mix.owners.push(voice);
  }
  index(mix, voice);
  tally(mix, voice, 1);
  detour(mix);
}

/**
 * Counts a voice leaving the list back out. A voice naming no subject stays in `general` and
 * `sharers`, which the caller filters once for every voice leaving together.
 */
export function delist<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (voice.named !== null) unindex(mix, voice);
  if (voice.holding !== null && mix.owners !== null)
    mix.owners = mix.owners.filter((v) => v !== voice);
  tally(mix, voice, -1);
  detour(mix);
}

/** Counts the list over from nothing, for a seek or a projection's copy. `owners` is the caller's. */
export function recount<I, O>(mix: Mixer<I, O>): void {
  mix.named = new Store<I, Voice<I, O>[]>();
  mix.naming = 0;
  mix.general = [];
  mix.sharers = [];
  mix.loci = 0;
  mix.anchored = 0;
  for (const voice of mix.cued) {
    index(mix, voice);
    tally(mix, voice, 1);
  }
  detour(mix);
  mix.steps.push(null, ++mix.version);
}
