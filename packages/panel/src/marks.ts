import type { Watched } from '@msb235/blits';
import type { MarkInfo } from './protocol.js';
import { AHEAD_CAP_MS } from './store.js';

/**
 * A mix's marks from `backMs` behind now, within its history, to `AHEAD_CAP_MS` ahead. `marks`
 * speaks the host's clock and the plots the mix's; `mix.time` converts. A mark ahead pinned to a
 * moment the mix clock stands still at, such as one announced ahead of a paused mix, is left out.
 */
export function marksOf(e: Watched, backMs: number): MarkInfo[] {
  const { mix } = e;
  const { now, timestamp } = mix;
  if (!Number.isFinite(now) || !Number.isFinite(timestamp)) return [];
  const lo = Math.max(e.reach, now - backMs);
  const hi = now + AHEAD_CAP_MS;
  const ahead = mix.when(hi);
  const from = Math.min(timestamp, mix.when(lo));
  const to = Number.isFinite(ahead) ? ahead : timestamp + AHEAD_CAP_MS;
  try {
    const out: MarkInfo[] = [];
    for (const k of mix.marks(from, to)) {
      const at = mix.time(k.timestamp);
      if (at < lo || at > hi) continue;
      if (k.timestamp > timestamp && k.timestamp - mix.when(at) > 1e-3) continue;
      out.push({
        at,
        mark: k.mark ?? null,
        voice: k.voice ?? null,
        name: k.name ?? null,
        tags: [...k.tags],
        track: k.track ?? null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
