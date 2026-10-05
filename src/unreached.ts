import type { Voice } from './mixer.js';

/** Whether the voice's shared unreached record stands for the subject numbered `slot`. */
export function unreached<I, O>(voice: Voice<I, O>, slot: number): boolean {
  const bits = voice.unreachedBits;
  if (bits === null || slot < 0) return false;
  const word = slot >>> 5;
  return word < bits.length && ((bits[word] as number) & (1 << (slot & 31))) !== 0;
}

/** Marks or clears the subject numbered `slot` as one the voice does not reach. */
export function unreach<I, O>(voice: Voice<I, O>, slot: number, on: boolean): void {
  let bits = voice.unreachedBits;
  const word = slot >>> 5;
  if (bits === null || word >= bits.length) {
    if (!on) return;
    const grown = new Uint32Array(Math.max(word + 1, (bits?.length ?? 0) * 2, 2));
    if (bits !== null) grown.set(bits);
    voice.unreachedBits = grown;
    bits = grown;
  }
  const bit = 1 << (slot & 31);
  bits[word] = on ? (bits[word] as number) | bit : (bits[word] as number) & ~bit;
}
