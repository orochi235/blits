import type { Watched } from '@msb235/blits';
import type { MarkInfo } from './protocol.js';
import { AHEAD_CAP_MS } from './store.js';

/**
 * A mix's marks from `backMs` behind now, within its history, to `AHEAD_CAP_MS` ahead. `marks`
 * speaks the host's clock and the plots the mix's: a mark's lead on the last sync, at the mix's
 * rate, is its lead on now.
 */
export function marksOf(e: Watched, backMs: number): MarkInfo[] {
  const { now, timestamp } = e.mix;
  if (!Number.isFinite(now) || !Number.isFinite(timestamp)) return [];
  const rate = e.mix.rate > 0 ? e.mix.rate : 1;
  const back = now - Math.max(e.reach, now - backMs);
  try {
    return e.mix.marks(timestamp - back / rate, timestamp + AHEAD_CAP_MS / rate).map((k) => ({
      at: now + (k.timestamp - timestamp) * rate,
      mark: k.mark ?? null,
      voice: k.voice ?? null,
      name: k.name ?? null,
      tags: [...k.tags],
    }));
  } catch {
    return [];
  }
}
