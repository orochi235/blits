import type { SpanHandle } from '@msb235/blits';
import type { Clip, Header } from '@pg/widgets/ScoreLanes';
import type { Built } from './compile';
import type { Group } from './composition';
import { clockOf, type Placed } from './placed';
import type { Subject } from './stage';

export interface Laying {
  built?: Built;
  placed?: Map<string, Placed>;
}

/** Group `g`'s header: its extent where blits put it, its fades, and a span's budget and fit. */
export function headerOf(
  g: Group,
  lane: number,
  depth: number,
  folded: boolean,
  o: Laying,
): Header {
  const p = o.placed?.get(g.id);
  const start = p?.start ?? g.start;
  const h: Header = {
    id: g.id,
    lane,
    depth,
    label: `${g.name} · ${g.kind}`,
    hue: g.hue,
    start,
    end: p?.end ?? p?.coast ?? Number.POSITIVE_INFINITY,
    folded,
  };
  if (g.fade.in) h.fadeIn = g.fade.in;
  if (g.fade.out) h.fadeOut = g.fade.out;
  if (g.kind !== 'span') return h;
  const handle = o.built?.groupHandles.get(g.id) as SpanHandle<Subject> | undefined;
  const clock = clockOf(handle);
  if (handle && p && clock > 0) {
    const r = handle.result;
    if (Number.isFinite(r.budget)) h.budget = start + r.budget / clock;
    if (r.over > 0) h.over = r.over / clock;
    h.fell = r.fell;
  } else if (g.span?.duration !== undefined && g.rate > 0)
    h.budget = start + g.span.duration / g.rate;
  return h;
}

/** The earliest end among the headers above a clip, with that group's fade out. */
export function cutUnder(above: readonly Header[]): Clip['cut'] {
  let first: Header | undefined;
  for (const h of above) if (Number.isFinite(h.end) && h.end < (first?.end ?? Infinity)) first = h;
  return first && { at: first.end, fade: first.fadeOut ?? 0 };
}
