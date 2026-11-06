import type { Flow, FlowEdge, FlowNode } from '@pg/widgets/FlowDiagram/types';
import { itemOf } from './flow';

const isItem = (id: string) => id.startsWith('voice:') || id.startsWith('group:');

function merged(f: FlowNode, t: FlowNode): FlowNode {
  const detail = [f.detail, t.detail].filter(Boolean).join('\n');
  return {
    ...f,
    ...(detail ? { detail } : {}),
    ...(t.tone ? { tone: t.tone } : {}),
    ...(f.faulted || t.faulted ? { faulted: true } : {}),
  };
}

/**
 * The signal flow and the timing of one composition as one diagram: every node of either, a voice
 * or group in both carrying both details and the timing's tone, the timing's boxes for owners and
 * spans in place of the flow's edges from a group to what it holds, and every timing edge marked
 * `timing`, its id prefixed `t:` so it cannot meet a flow edge's.
 */
export function bothOf(flow: Flow, timing: Flow): Flow {
  const boxes = timing.boxes ?? [];
  const boxed = new Set(boxes.map((b) => b.id));
  // A boxed group's steps go into its box: what fed them feeds the box.
  const into = new Map<string, string>();
  for (const n of flow.nodes) {
    const item = n.kind === 'step' ? itemOf(flow, n.id) : n.id;
    if (boxed.has(item)) into.set(n.id, item);
  }
  const timed = new Map(timing.nodes.map((n) => [n.id, n]));
  const flowed = new Set(flow.nodes.map((n) => n.id));
  const nodes: FlowNode[] = [];
  for (const n of flow.nodes) {
    if (into.has(n.id)) continue;
    const t = timed.get(n.id);
    nodes.push(t ? merged(n, t) : n);
  }
  for (const n of timing.nodes) if (!flowed.has(n.id)) nodes.push(n);
  const edges: FlowEdge[] = [];
  for (const e of flow.edges) {
    if (into.has(e.from) && (isItem(e.to) || into.has(e.to))) continue;
    const to = into.get(e.to);
    edges.push(to === undefined ? e : { ...e, id: `${e.from}->${to}`, to });
  }
  return {
    nodes,
    edges: [...edges, ...timing.edges.map((e) => ({ ...e, id: `t:${e.id}`, timing: true }))],
    boxes,
  };
}
