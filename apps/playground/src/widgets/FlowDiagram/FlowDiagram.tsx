import { registerCanvasFont } from '@weasel-js/core';
import { DiagramView, diagramScene, type LayoutDirection } from '@weasel-js/diagram';
import { useMemo } from 'react';
import { linesOf, styleOf } from './style';
import type { Flow } from './types';

registerCanvasFont('sans-serif');

export interface FlowDiagramProps {
  flow: Flow;
  width: number;
  height: number;
  direction?: LayoutDirection;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}

export function FlowDiagram({
  flow,
  width,
  height,
  direction = 'down',
  selected,
  onSelect,
}: FlowDiagramProps) {
  const specs = useMemo(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    return diagramScene(
      { nodes: flow.nodes.map((n) => ({ id: n.id, lines: linesOf(n) })), edges: flow.edges },
      {
        layoutOptions: { direction, order: 'barycenter', nodeGap: 24, rankGap: 48 },
        nodeStyle: (d) => styleOf(byId.get(d.id)!),
      },
    );
  }, [flow, direction]);
  return (
    <DiagramView
      specs={specs}
      width={width}
      height={height}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
