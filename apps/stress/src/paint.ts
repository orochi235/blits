import { toHex } from '@msb235/blits';

/** An ink pose as `#rrggbb`, laid over `under`. */
export function hex(pose: ArrayLike<number>, under = 0x14161a): string {
  return `#${toHex(pose, under).toString(16).padStart(6, '0')}`;
}

/** Cells per row and column so `n` equal cells fill `w` by `h` as squarely as they can. */
export function tiling(n: number, w: number, h: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * w) / h)));
  return { cols, rows: Math.ceil(n / cols) };
}
