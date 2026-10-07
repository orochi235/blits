import type { Flow } from '@pg/widgets/FlowDiagram/types';

/** What the diagram draws and nothing else, so equal keys mean the same picture. */
export function flowKey(flow: Flow): string {
  return JSON.stringify([
    flow.nodes.map((n) => [n.id, n.kind, n.label, n.detail, n.hue, n.faulted]),
    flow.edges.map((e) => [e.id, e.from, e.to, e.label]),
  ]);
}
