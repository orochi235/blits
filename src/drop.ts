import { headOf, unlink } from './chain.js';
import { leaveVoice } from './fade.js';
import { goneIndex } from './gone.js';
import { releasing } from './history.js';
import type { Mixer } from './mixer.js';
import type { Motions } from './motions.js';
import { nextFrame } from './move.js';
import { Masked } from './store.js';
import { record, taping, unplayable } from './tape.js';
import type { Voice } from './voice.js';

export function drop<I, O>(this: Mixer<I, O>, subject: I): void {
  this.frame = nextFrame();
  const head = headOf(this, subject);
  // Nothing that kept this head, such as `pull`'s remembered list, may take it as current again.
  if (head !== undefined) unlink(this, head);
  // A number a seek carried over is released even where its chain is not linked since.
  const slot = this.chains.get(subject)?.slot ?? -1;
  if (slot >= 0 && this.lanes !== null) this.lanes.release(slot);
  // A read ahead's copy reads the live mix's poses, and so hides one where the mix deletes it.
  if (this.projecting && !(this.pose instanceof Masked)) this.pose = new Masked(this.pose);
  this.pose.delete(subject);
  this.restStamps?.delete(subject);
  this.chains.delete(subject);
  this.stir();
  // A record of it is only in a voice over every subject, one naming it, or one gone; a ramp out
  // of a voice that does not name it is in `parters`, and a patch's own state in `motions`.
  const kept = releasing(this);
  for (const voice of this.general) this.forgetIn(voice, subject, kept);
  const named = this.named.get(subject);
  if (named !== undefined) for (const voice of [...named]) this.forgetIn(voice, subject, kept);
  const gone = goneIndex(this);
  for (const voice of gone.general) this.forgetIn(voice, subject, kept);
  const goneNaming = gone.named.get(subject);
  if (goneNaming !== undefined) for (const voice of goneNaming) this.forgetIn(voice, subject, kept);
  if (this.owners !== null) for (const voice of this.owners) this.forgetIn(voice, subject, kept);
  for (const voice of this.parters) {
    this.forgetIn(voice, subject, kept);
    if (voice.parts?.size === 0) voice.parts = null;
    if (voice.parted?.size === 0) voice.parted = null;
    if (voice.parts === null && voice.parted === null) this.parters.delete(voice);
  }
  const strays = this.strays.get(subject);
  if (strays !== undefined) for (const motion of strays) this.releaseIn(motion, subject, kept);
  this.strays.delete(subject);
  for (const motion of this.strayAll) this.releaseIn(motion, subject, kept);
  if (taping(this)) this.recordDrop(subject);
}

/** Lets `voice` go of a dropped subject. Methods rather than closures, so a drop makes neither. */
export function forgetIn<I, O>(
  this: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  kept: ReturnType<typeof releasing>,
): void {
  leaveVoice(this, voice, subject);
  voice.subjects.delete(subject);
  if (voice.motion !== undefined) this.releaseIn(voice.motion, subject, kept);
  voice.parts?.delete(subject);
  voice.parted?.delete(subject);
  voice.blend?.of.reads.delete(subject);
}

// A motion patch's state is the live mix's alone: a read ahead cannot start a subject afresh in it.
export function releaseIn<I, O>(
  this: Mixer<I, O>,
  motion: Motions<I>,
  subject: I,
  kept: ReturnType<typeof releasing>,
): void {
  if (!this.projecting) motion.release(subject, kept[0], kept[1], kept[2], kept[3]);
  else if (motion.holds(subject)) unplayable('a drop of a subject a motion patch holds');
}

export function recordDrop<I, O>(this: Mixer<I, O>, subject: I): void {
  record(this, 'drop', (stage) => stage.mix(this)?.drop(subject));
}
