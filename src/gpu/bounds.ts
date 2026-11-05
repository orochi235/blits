import type { Runner } from './runner.js';
import type { ChannelCode } from './wgsl/channels.js';

const ALL = ', so every channel stays on the CPU';

/**
 * Why a fold of `channels` for `n` subjects, by a kernel over `runners`, cannot bind its output or
 * subjects buffer within `limit` bytes; null where both fit. `within` keeps each voice's own share
 * of the values and per-subject buffers inside it.
 */
export function overBinding(
  channels: ReadonlyMap<string, ChannelCode>,
  runners: readonly Runner[],
  n: number,
  limit: number,
): string | null {
  let axes = 0;
  for (const c of channels.values()) axes += c.axes;
  if (axes * n * 4 > limit)
    return `its channels would take the output buffer past the largest the device binds${ALL}`;
  const fields = new Set(runners.flatMap((r) => r.fields)).size;
  if (Math.max(1, fields) * n * 4 > limit)
    return `the subjects' fields would take the subjects buffer past the largest the device binds${ALL}`;
  return null;
}

/** Why a frame's table of `bytes` cannot bind within `limit`; null where it fits. */
export function overTable(bytes: number, limit: number): string | null {
  return bytes > limit
    ? `its voices would take the table buffer past the largest the device binds${ALL}`
    : null;
}
