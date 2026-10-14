import { registerCanvasFont } from '@weasel-js/core';
import { DiagramView, diagramScene, type LayoutDirection } from '@weasel-js/diagram';
import { useMemo } from 'react';
import { boxStyleOf, edgeStyleOf, linesOf, styleOf } from './style';
import type { Flow } from './types';

// diagramScene sets text in sans-serif; labels paint blank unless the family is registered.
registerCanvasFont('sans-serif');

// weasel sizes a group's box by its members alone, so a label wider than they are runs out of it;
// until it sizes by the label too, the first member is held at least this wide per character.
const LABEL_CHAR = 7;

const endsOf = (e: { from: string; to: string; label?: string }) =>
  `${e.from}\n${e.to}\n${e.label ?? ''}`;

export interface FlowDiagramProps {
  flow: Flow;
  width: number;
  height: number;
  direction?: LayoutDirection;
  minScale?: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}

export function FlowDiagram({
  flow,
  width,
  height,
  direction = 'down',
  minScale = 0.75,
  selected,
  onSelect,
}: FlowDiagramProps) {
  const specs = useMemo(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const boxes = new Map((flow.boxes ?? []).map((b) => [b.id, b]));
    const edges = new Map(flow.edges.map((e) => [endsOf(e), e]));
    const atLeast = new Map<string, number>();
    for (const b of boxes.values()) {
      const first = b.members.find((m) => byId.has(m));
      if (first) atLeast.set(first, b.label.length * LABEL_CHAR);
    }
    return diagramScene(
      {
        nodes: flow.nodes.map((n) => ({
          id: n.id,
          lines: linesOf(n),
          ...(atLeast.has(n.id) ? { width: atLeast.get(n.id) } : {}),
        })),
        edges: flow.edges.map((e) => ({
          from: e.from,
          to: e.to,
          ...(e.label ? { label: e.label } : {}),
        })),
        groups: [...boxes.values()].map((b) => ({ id: b.id, label: b.label, members: b.members })),
      },
      {
        layoutOptions: { direction, order: 'barycenter', nodeGap: 24, rankGap: 48 },
        nodeStyle: (d) => styleOf(byId.get(d.id)!),
        groupStyle: (g) => boxStyleOf(boxes.get(g.id)!),
        edgeStyle: (e) => edgeStyleOf(edges.get(endsOf(e)) ?? {}),
      },
    );
  }, [flow, direction]);
  return (
    <DiagramView
      specs={specs}
      width={width}
      height={height}
      minScale={minScale}
      anchor="start"
      selected={selected}
      onSelect={onSelect}
    />
  );
}
