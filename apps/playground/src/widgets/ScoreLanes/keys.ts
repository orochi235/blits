import type { KeyboardEvent } from 'react';

export const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/** Arrow keys step 100 ms, 1 s with Shift; null for any other key. */
export function nudge(e: KeyboardEvent): number | null {
  const dir =
    e.key === 'ArrowRight' || e.key === 'ArrowUp'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? -1
        : 0;
  if (!dir) return null;
  e.preventDefault();
  return dir * (e.shiftKey ? 1000 : 100);
}

export const activates = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
