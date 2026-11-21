import type { DataEdge, EdgeStyle, LayoutDirection } from '@weasel-js/diagram';
import { edgeStyleOf } from './style';
import type { FlowEdge } from './types';

/** Where a flow edge leaves and meets its nodes: what a node acts on runs along the flow's axis, in
 *  at the near side and out at the far one; a parameter comes in across it. */
const AXIS: Record<LayoutDirection, { out: string; in: string; param: string }> = {
  down: { out: 's', in: 'n', param: 'w' },
  up: { out: 'n', in: 's', param: 'w' },
  right: { out: 'e', in: 'w', param: 'n' },
  left: { out: 'w', in: 'e', param: 'n' },
};
const portsOf = (direction: LayoutDirection, e: Pick<FlowEdge, 'param' | 'port'>) => {
  const a = AXIS[direction];
  return { fromPort: a.out, toPort: e.port ?? (e.param ? a.param : a.in) };
};

// Prefixed so an edge's id never reads as a node's, as `voice:a->b` would to a picker.
const idOf = (e: FlowEdge) => `edge:${e.id}`;

/** The scene's edges for a flow's, and each one's style, found by the edge's own id. */
export function edgesOf(edges: readonly FlowEdge[], direction: LayoutDirection) {
  const byId = new Map(edges.map((e) => [idOf(e), e]));
  return {
    specs: edges.map(
      (e): DataEdge => ({
        id: idOf(e),
        from: e.from,
        to: e.to,
        ...(e.timing ? {} : portsOf(direction, e)),
        ...(e.label ? { label: e.label } : {}),
      }),
    ),
    styleOf: (e: DataEdge): EdgeStyle => edgeStyleOf((e.id && byId.get(e.id)) || {}),
  };
}
