import { clipEnd } from './geometry';
import type { Clip, ClipEdit } from './index';

export type Handle = 'body' | 'fadeIn' | 'fadeOut' | 'end';

export function dragEdit(c: Clip, handle: Handle, dt: number): ClipEdit | null {
  if (handle === 'body')
    return c.locked ? null : { clip: c.id, kind: 'move', start: Math.max(0, c.start + dt) };
  if (handle === 'end') {
    if (c.pass <= 0) return null;
    if (!Number.isFinite(c.passes)) return { clip: c.id, kind: 'passes', passes: 1 };
    return { clip: c.id, kind: 'passes', passes: Math.max(1, Math.round(c.passes + dt / c.pass)) };
  }
  const length = Number.isFinite(clipEnd(c)) ? clipEnd(c) - c.start : Number.POSITIVE_INFINITY;
  const was = handle === 'fadeIn' ? c.fadeIn : c.fadeOut;
  const ms = Math.min(length, Math.max(0, was + (handle === 'fadeIn' ? dt : -dt)));
  return { clip: c.id, kind: handle, ms };
}
