import type { FlowPortTone } from '@pg/widgets/FlowDiagram/types';
import { waitOn } from './anchor';
import { blendOf, setBlend, withVoice } from './blend';
import { type Composition, isExpr } from './composition';
import { setGroup } from './groupEdits';
import { underSpan } from './groups';
import { load } from './load';

/**
 * What a port of a diagram node does when dragged in the Both tab. A voice or group takes a weight
 * at its top (`n`) and is placed by its start (`w`) and end (`e`); a level, a signal or a whole
 * `weight` gives a signal from its bottom (`s`), and so does a mark.
 */
export type Role = 'weight' | 'start' | 'end' | 'signal' | 'mark';

/** A port of a node, by the node's id in the flow or timing and the port's compass name. */
export interface End {
  node: string;
  port: string;
}

const isItem = (node: string) => node.startsWith('voice:') || node.startsWith('group:');
const idOf = (node: string) => node.slice(node.indexOf(':') + 1);

/** The role of `port` on `node`, or null for a port that does nothing; `code` is `flowOf`'s. */
export function roleOf(code: ReadonlyMap<string, string>, node: string, port: string): Role | null {
  if (isItem(node))
    return port === 'n' ? 'weight' : port === 'w' ? 'start' : port === 'e' ? 'end' : null;
  if (port !== 's') return null;
  if (node.startsWith('mark:')) return 'mark';
  return code.has(node) ? 'signal' : null;
}

const TONE: Record<Role, FlowPortTone> = {
  weight: 'flow',
  signal: 'flow',
  start: 'timing',
  end: 'timing',
  mark: 'timing',
};

/** The kind of edge `port` on `node` makes, which it is drawn in the color of; null for none. */
export function toneOf(code: ReadonlyMap<string, string>, node: string, port: string) {
  const role = roleOf(code, node, port);
  return role === null ? null : TONE[role];
}

const SOURCES: readonly Role[] = ['signal', 'mark'];

function weighted(c: Composition, node: string, code: string): Composition {
  const id = idOf(node);
  const v = c.voices.find((x) => x.id === id);
  if (v) {
    const blend = blendOf(c, v);
    if (blend) return blend.by.code === code ? c : setBlend(c, blend.locus, { code });
    if (isExpr(v.weight) && v.weight.code === code) return c;
    return withVoice(c, { ...v, weight: { code } });
  }
  const g = c.groups?.find((x) => x.id === id);
  if (!g || (isExpr(g.weight) && g.weight.code === code)) return c;
  return setGroup(c, { ...g, weight: { code } });
}

function placed(
  c: Composition,
  node: string,
  slot: 'start' | 'end',
  name: string,
  edge: 'start' | 'end',
): Composition {
  const id = idOf(node);
  const item = c.voices.find((x) => x.id === id) ?? c.groups?.find((x) => x.id === id);
  if (!item || item.name === name || (slot === 'start' && underSpan(c, id))) return c;
  const anchor = waitOn(item.anchor, slot, name, edge);
  if (JSON.stringify(anchor) === JSON.stringify(item.anchor)) return c;
  if ('patch' in item) return withVoice(c, { ...item, anchor });
  return setGroup(c, { ...item, anchor });
}

/**
 * `c` with the edge a drag from port `a` to port `b` describes, or null when it describes none,
 * changes nothing, or leaves something `load` refuses. A signal dropped on a voice's or group's top
 * becomes its `weight`, or a blend's signal for a voice in one. From a start or end, or a mark, to
 * a start or end anchors the second to the first: `{ with }` its start or a mark, `{ after }` its
 * end. A drag the other way, from a top or a start onto a signal or a mark, is read in reverse.
 * Under a span, a start is the span's to place and is refused.
 */
export function wired(
  c: Composition,
  code: ReadonlyMap<string, string>,
  a: End,
  b: End,
): Composition | null {
  let [from, to] = [a, b];
  let [rf, rt] = [roleOf(code, a.node, a.port), roleOf(code, b.node, b.port)];
  if (rf === null || rt === null || a.node === b.node) return null;
  if (SOURCES.includes(rt) && !SOURCES.includes(rf)) [from, to, rf, rt] = [to, from, rt, rf];
  let next = c;
  if (rf === 'signal') {
    if (rt === 'weight') next = weighted(c, to.node, code.get(from.node) ?? '');
  } else if (rf !== 'weight' && (rt === 'start' || rt === 'end')) {
    const name = rf === 'mark' ? idOf(from.node) : itemName(c, from.node);
    if (name !== undefined) next = placed(c, to.node, rt, name, rf === 'end' ? 'end' : 'start');
  }
  return next !== c && load(next) !== null ? next : null;
}

function itemName(c: Composition, node: string): string | undefined {
  const id = idOf(node);
  return (c.voices.find((x) => x.id === id) ?? c.groups?.find((x) => x.id === id))?.name;
}
