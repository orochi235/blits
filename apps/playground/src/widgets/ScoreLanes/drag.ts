import { clipEnd, MAX_PASSES } from './geometry';
import type { Clip, ClipEdit, Hatch } from './index';

export type Handle = 'body' | 'fadeIn' | 'fadeOut' | 'end';

export function dragEdit(c: Clip, handle: Handle, dt: number): ClipEdit | null {
  if (handle === 'body')
    return c.locked ? null : { clip: c.id, kind: 'move', start: Math.max(0, c.start + dt) };
  if (handle === 'end') return endEdit(c, dt);
  const was = handle === 'fadeIn' ? c.fadeIn : c.fadeOut;
  const ms = Math.min(fadeRoom(c, handle), Math.max(0, was + (handle === 'fadeIn' ? dt : -dt)));
  return { clip: c.id, kind: handle, ms };
}

/**
 * The end dragged `dt`, snapped to whole passes. Under a group's cut it snaps to the cut too, and
 * no further: reaching the cut keeps passes that already reach it, or takes the fewest that do.
 */
function endEdit(c: Clip, dt: number): ClipEdit | null {
  if (c.pass <= 0) return null;
  const room = c.cut ? (c.cut.at - c.start) / c.pass : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(c.passes) && !Number.isFinite(room))
    return { clip: c.id, kind: 'passes', passes: 1 };
  const target = Math.min(c.passes, room) + dt / c.pass;
  const whole = Math.min(MAX_PASSES, Math.max(1, Math.round(target)));
  const passes = (n: number): ClipEdit => ({ clip: c.id, kind: 'passes', passes: n });
  if (whole < room && Math.abs(target - whole) <= room - target) return passes(whole);
  return c.passes >= room ? null : passes(Math.min(MAX_PASSES, Math.ceil(room)));
}

/** The longest a fade can be: the clip's length less the other fade. */
export function fadeRoom(c: Clip, handle: 'fadeIn' | 'fadeOut'): number {
  const end = clipEnd(c);
  if (!Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.max(0, end - c.start - (handle === 'fadeIn' ? c.fadeOut : c.fadeIn));
}

export function hatchOf(c: Clip): Hatch {
  if (c.freezeBefore && c.freezeAfter) return 'both';
  if (c.freezeBefore) return 'before';
  if (c.freezeAfter) return 'after';
  return null;
}

/** Dropping clip `id` on `lane`'s label groups it with that lane's first clip. */
export function groupDrop(clips: readonly Clip[], id: string, lane: number): ClipEdit | null {
  const moving = clips.find((c) => c.id === id);
  const target = clips.find((c) => c.lane === lane && c.id !== id);
  if (!moving || !target || moving.lane === lane) return null;
  if (moving.group !== undefined && moving.group === target.group) return null;
  return { clip: id, kind: 'group', with: target.id };
}
