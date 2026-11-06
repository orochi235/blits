import type { Flow } from '@pg/widgets/FlowDiagram/types';

/** What the diagram draws and nothing else, so equal keys mean the same picture. */
export function flowKey(flow: Flow): string {
  return JSON.stringify([
    flow.nodes.map((n) => [
      n.id,
      n.kind,
      n.label,
      n.aside,
      n.params,
      n.detail,
      n.stamp,
      n.stampWeight,
      n.grid,
      n.inputs,
      n.hue,
      n.faulted,
      n.tone,
    ]),
    flow.edges.map((e) => [
      e.id,
      e.from,
      e.to,
      e.label,
      e.dashed,
      e.timing,
      e.met,
      e.param,
      e.port,
    ]),
    (flow.boxes ?? []).map((b) => [b.id, b.label, b.members, b.hue, b.faulted, b.tone]),
  ]);
}
