import type { Flow, FlowNode } from '@pg/widgets/FlowDiagram/types';

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
  const timed = new Map(timing.nodes.map((n) => [n.id, n]));
  const flowed = new Set(flow.nodes.map((n) => n.id));
  const nodes: FlowNode[] = [];
  for (const n of flow.nodes) {
    if (boxed.has(n.id)) continue;
    const t = timed.get(n.id);
    nodes.push(t ? merged(n, t) : n);
  }
  for (const n of timing.nodes) if (!flowed.has(n.id)) nodes.push(n);
  return {
    nodes,
    edges: [
      ...flow.edges.filter((e) => !(boxed.has(e.from) && isItem(e.to))),
      ...timing.edges.map((e) => ({ ...e, id: `t:${e.id}`, timing: true })),
    ],
    boxes,
  };
}
