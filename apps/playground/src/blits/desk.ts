import { toHex } from '@msb235/blits';
import type { Flow } from '@pg/widgets/FlowDiagram/types';
import type { Desk, DeskBus, DeskGroup, DeskStrip } from '@pg/widgets/MixerDesk/types';
import { hexOf } from './color';
import type { Composition } from './composition';
import { rowsOf } from './groups';
import type { ChannelName, Mixed } from './kit';

/**
 * The mixer desk of a composition: a bus per channel its `flow` (what `flowOf` built from it)
 * says is written, a strip per voice tapping the channels the flow has it write, and a bracket
 * per group over what it holds. Strips run in the score's order, so a group's sit together.
 */
export function deskOf(comp: Composition, flow: Flow): Desk {
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  const buses: DeskBus[] = flow.nodes
    .filter((n) => n.kind === 'channel')
    .map((n) => ({ id: n.label, label: n.label, rule: n.detail ?? '' }));
  const taps = new Map<string, string[]>();
  for (const e of flow.edges) {
    const to = nodes.get(e.to);
    if (to?.kind !== 'channel' || nodes.get(e.from)?.kind !== 'voice') continue;
    taps.set(e.from, [...(taps.get(e.from) ?? []), to.label]);
  }
  const rows = rowsOf(comp);
  const strips: DeskStrip[] = [];
  for (const r of rows) {
    const n = r.kind === 'voice' ? nodes.get(`voice:${r.id}`) : undefined;
    if (!n) continue;
    strips.push({
      id: r.id,
      label: n.label,
      taps: taps.get(n.id) ?? [],
      ...(n.detail !== undefined ? { detail: n.detail } : {}),
      ...(n.hue !== undefined ? { hue: n.hue } : {}),
      ...(n.faulted ? { faulted: true } : {}),
    });
  }
  const groups: DeskGroup[] = [];
  for (const [i, r] of rows.entries()) {
    const n = r.kind === 'group' ? nodes.get(`group:${r.id}`) : undefined;
    if (!n) continue;
    const held: string[] = [];
    for (const below of rows.slice(i + 1)) {
      if (below.depth <= r.depth) break;
      if (below.kind === 'voice') held.push(below.id);
    }
    const first = held[0];
    const last = held.at(-1);
    if (first === undefined || last === undefined) continue;
    groups.push({
      id: r.id,
      label: n.label,
      first,
      last,
      depth: r.depth,
      ...(n.hue !== undefined ? { hue: n.hue } : {}),
      ...(n.faulted ? { faulted: true } : {}),
    });
  }
  return { buses, strips, ...(groups.length > 0 ? { groups } : {}) };
}

const fixed = (v: number | undefined, places: number) =>
  v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(places);

/** How the desk prints a channel's folded value; a color also gets its swatch. */
export function readoutOf(ch: ChannelName, pose: Mixed): Pick<DeskBus, 'value' | 'swatch'> {
  if (ch === 'offset') return { value: `${fixed(pose.offset[0], 1)}, ${fixed(pose.offset[1], 1)}` };
  if (ch === 'color') {
    if (!pose.color || !((pose.color[3] ?? 0) > 0)) return { value: 'none' };
    const hex = hexOf(toHex(pose.color));
    return { value: hex, swatch: hex };
  }
  return { value: fixed(pose[ch], 2) };
}

/**
 * The desk lit by one sample of the picked subject: each strip and group at its `weightOf`, 0
 * where the mix has no handle for it, and each bus at the folded value. Unlit with no sample.
 */
export function litDesk(
  desk: Desk,
  sample: { full: Mixed; weights: ReadonlyMap<string, number> } | undefined,
): Desk {
  if (!sample) return desk;
  const level = (id: string) => sample.weights.get(id) ?? 0;
  return {
    buses: desk.buses.map((b) => ({ ...b, ...readoutOf(b.id as ChannelName, sample.full) })),
    strips: desk.strips.map((s) => ({ ...s, level: level(s.id) })),
    ...(desk.groups ? { groups: desk.groups.map((g) => ({ ...g, level: level(g.id) })) } : {}),
  };
}
