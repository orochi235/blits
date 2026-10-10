import { restamp } from './everyone.js';
import type { Mixer } from './mixer.js';
import { nextFrame } from './move.js';
import type { Subject } from './voice.js';

/**
 * What `Mix.touch` does: makes stale every delta read this frame, for one subject or for all, so
 * the next probe calls each patch again, on either path.
 */
export function touch<I, O>(mix: Mixer<I, O>, subject?: I): void {
  mix.frame = nextFrame();
  if (subject === undefined) {
    // A motion patch reads nothing from outside the mix, and an owner has no delta.
    for (const voice of mix.cued)
      if (voice.motion === undefined && voice.holding === null) {
        voice.seeks++;
        voice.touches++;
      }
  } else {
    // No voice's `seeks` is below 0, so no record stamped with it reads as current.
    let held: Subject<unknown> | null = mix.chains.get(subject) ?? null;
    for (; held !== null; held = held.next) held.seeks = -1;
    const slot = mix.chains.get(subject)?.slot ?? -1;
    for (const voice of mix.sharers) restamp(voice, slot);
  }
  mix.lanes?.refill();
  mix.stir();
}
