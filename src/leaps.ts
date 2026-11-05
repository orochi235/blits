import type { Mixer } from './mixer.js';
import { descendants } from './owner.js';
import type { Voice } from './voice.js';

/**
 * Under history, keeps an owner's first seek forward since the last frame, with the voices under it
 * yet to start: the next frame starts them in order, and a seek back to this frame must leave them
 * waiting for it, not started from the owner's clock as sought.
 */
export function leap<I, O>(mix: Mixer<I, O>, owner: Voice<I, O>): void {
  const pending: Voice<I, O>[] = [];
  descendants(owner, (v) => {
    if (v.state === 'pending') pending.push(v);
  });
  // With a store a seek reaches past memory, so nothing ages out; the host bounds the tape.
  const reach =
    mix.transport.pager === null
      ? mix.now - (mix.opts.history as { ms: number }).ms
      : Number.NEGATIVE_INFINITY;
  const leaps = (owner.leaps ?? []).filter((l) => l.at >= reach);
  leaps.push({ seq: mix.transport.seq, at: mix.now, pending });
  owner.leaps = leaps;
}

/**
 * On a seek back to the end of frame `seq`, after each voice's state is put back: the owners sought
 * forward after that frame are leapt again, and what they held yet to start waits once more.
 */
export function leapBack<I, O>(mix: Mixer<I, O>, kept: readonly Voice<I, O>[], seq: number): void {
  mix.leapt = null;
  for (const owner of kept) {
    const leaps = owner.leaps;
    if (leaps === null) continue;
    const before = leaps.filter((l) => l.seq <= seq);
    owner.leaps = before.length === 0 ? null : before;
    const l = before[before.length - 1];
    if (l === undefined || l.seq !== seq) continue;
    mix.leapt ??= new Set();
    mix.leapt.add(owner);
    for (const v of l.pending) if (v.out === null && kept.includes(v)) v.state = 'pending';
  }
}
