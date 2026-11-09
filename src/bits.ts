import { grownWords } from './grow.js';

/** Whether bit `slot` is set; false for no bits, a negative slot, or one past their end. */
export function hasBit(bits: Uint32Array | null, slot: number): boolean {
  if (bits === null || slot < 0) return false;
  const word = slot >>> 5;
  return word < bits.length && ((bits[word] as number) & (1 << (slot & 31))) !== 0;
}

/** Sets bit `slot`, in `bits` or, where they end before it, in a copy at least `words` long. */
export function setBit(bits: Uint32Array | null, slot: number, words: number): Uint32Array {
  const word = slot >>> 5;
  const out =
    bits === null || word >= bits.length ? grownWords(bits, Math.max(word + 1, words)) : bits;
  out[word] = (out[word] as number) | (1 << (slot & 31));
  return out;
}

/** Clears bit `slot` where `bits` hold it. */
export function clearBit(bits: Uint32Array | null, slot: number): void {
  const word = slot >>> 5;
  if (bits !== null && word < bits.length)
    bits[word] = (bits[word] as number) & ~(1 << (slot & 31));
}
