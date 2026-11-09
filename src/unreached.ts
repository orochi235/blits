import { clearBit, hasBit, setBit } from './bits.js';
import type { Voice } from './voice.js';

/** Whether the voice's shared unreached record stands for the subject numbered `slot`. */
export function unreached<I, O>(voice: Voice<I, O>, slot: number): boolean {
  return hasBit(voice.unreachedBits, slot);
}

/** Marks or clears the subject numbered `slot` as one the voice does not reach. */
export function unreach<I, O>(voice: Voice<I, O>, slot: number, on: boolean): void {
  const bits = voice.unreachedBits;
  if (!on) clearBit(bits, slot);
  else voice.unreachedBits = setBit(bits, slot, Math.max((bits?.length ?? 0) * 2, 2));
}

/** The subject numbered `from` is numbered `to` now, a number let go of: its mark moves along. */
export function reunreach<I, O>(voice: Voice<I, O>, from: number, to: number): void {
  if (!unreached(voice, from)) return;
  unreach(voice, to, true);
  unreach(voice, from, false);
}
