import type { Handle, MarkName } from '@msb235/blits';
import type { ScoreMark } from '@pg/widgets/ScoreLanes';
import type { Built } from './compile';
import type { Subject } from './stage';

/**
 * A voice's or group's marks, its five and those placed inside it, in composition ms; a mark
 * nothing has fixed yet is absent.
 */
export type Placed = Partial<Record<MarkName, number>>;

/**
 * Where `built`'s mix put each voice and group, by id, read from `mix.marks`. `built` must not have
 * synced since it was compiled: its marks' timestamps are then composition ms, as the player's
 * first frames are, before a seek back by `mix.seek` moves the mix's clock off the host's.
 */
export function placedOf(built: Built): Map<string, Placed> {
  const ids = new Map<number, string>();
  for (const [id, h] of built.handles) ids.set(h.id, id);
  for (const [id, h] of built.groupHandles) ids.set(h.id, id);
  const out = new Map<string, Placed>();
  for (const m of built.mix.marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)) {
    const id = m.voice === undefined ? undefined : ids.get(m.voice);
    if (id === undefined || m.mark === undefined) continue;
    const p = out.get(id) ?? (Object.create(null) as Placed);
    out.set(id, p);
    p[m.mark] = m.timestamp;
  }
  return out;
}

/** Where blits put each of the marks a voice or group placed inside itself, by its name. */
export function innerOf(marks: Record<string, number> | undefined, p: Placed): ScoreMark[] {
  const out: ScoreMark[] = [];
  for (const label of Object.keys(marks ?? {})) {
    const at = p[label];
    if (at !== undefined) out.push({ at, label });
  }
  return out;
}

/** Ms of `h`'s own clock per mix ms: its rate times every owner's above it; 1 for none. */
export function clockOf(h: Handle<Subject> | undefined): number {
  let r = 1;
  for (let at = h; at; at = at.owner) r *= at.rate;
  return r;
}
