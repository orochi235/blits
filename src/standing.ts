import { ownBlends } from './blend.js';
import type { Mixer } from './mixer.js';
import { relink } from './owner.js';
import { pin } from './place.js';
import { count, recall, stateAt } from './project.js';
import type { Cut, Transport } from './transport.js';
import type { Voice } from './voice.js';

/**
 * Why a voice cannot be read at an earlier time from how it stands now, or undefined where it can:
 * what it shows depends on more than its clock as cued, so the frames it has played decided it.
 */
function unfit<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): string | undefined {
  const patch = voice.patch;
  const spec = voice.spec;
  if (patch.state !== undefined || patch.step !== undefined) return 'its patch keeps state';
  if (voice.motion !== undefined) return 'it plays a motion';
  if (voice.keeping) return 'its patch or its weight keeps state';
  if (spec.from === 'current') return 'it starts from the pose its subjects had';
  if (voice.written) return 'its handle has been written to';
  if (spec.anchor !== undefined) return 'an anchor places it';
  if (voice.holding !== null) return 'it is an owner';
  if (voice.owner !== null) return 'it plays under an owner';
  // A rest-less channel switches on across a band, by the weights its voice has passed through.
  const steady =
    typeof spec.weight !== 'function' &&
    spec.locus === undefined &&
    !((voice.fade.in ?? 0) > 0) &&
    !((voice.fade.out ?? 0) > 0);
  if (!steady && voice.slots.some((s) => mix.channels[s]?.rest === undefined))
    return 'it writes a channel with no rest at a weight that moves';
  return undefined;
}

/**
 * Throws unless a read back to mix time `t` is exact with no history: every voice plays as it was
 * cued and reads the same whenever it is asked, and no mix on the transport has changed since `t`.
 * A mix keeps only how it stands now, which is how it has stood since its last change.
 */
export function stands(transport: Transport, t: number): void {
  const need = `blits: reading back to ${t} needs a mix made with history`;
  if (transport.pace !== null) throw new Error(`${need}: the mix's rate has been set`);
  if (t < transport.settled)
    throw new Error(
      `${need}: a mix changed or a voice left at ${transport.settled}, and without history a mix keeps only how it stands now`,
    );
  for (const mix of transport.members)
    for (const voice of mix.cued) {
      if (voice.state === 'done') continue;
      const why = unfit(mix, voice);
      if (why !== undefined) throw new Error(`${need}: voice ${voice.id} is cued, and ${why}`);
    }
}

/** A mix's copy for a read back to `t` with no history: its voices as they stand, each at `t`. */
export function copyStanding<I, O>(mix: Mixer<I, O>, c: Mixer<I, O>, t: number, cut: Cut): void {
  c.pose = mix.pose;
  c.wantsPose = mix.wantsPose;
  c.reducedNow = mix.reducedNow;
  c.backward = true;
  c.cued = mix.cued
    .filter((v) => v.state !== 'done')
    .map((v) => {
      const copy: Voice<I, O> = v.copy((subject) => recall(mix, v, subject, t, cut));
      // A fade its own end began after `t` had not begun then.
      if (copy.out !== null && copy.out.at > t) copy.out = null;
      const at = mix.pins?.get(v);
      if (at !== undefined) pin(c, copy, at);
      return copy;
    });
  ownBlends(c.cued);
  if (mix.owners !== null) relink(c.cued);
  stateAt(c, t);
  count(c);
}
