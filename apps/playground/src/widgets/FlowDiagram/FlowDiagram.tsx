import { registerCanvasFont } from '@weasel-js/core';
import {
  DiagramView,
  type DiagramViewProps,
  diagramScene,
  isBodyEnd,
  type LayoutDirection,
  type NodeMove,
} from '@weasel-js/diagram';
import { useMemo, useRef } from 'react';
import { boxStyleOf, edgeStyleOf, linesOf, portColorOf, styleOf } from './style';
import type { Flow, FlowBox, FlowEnd, FlowNode, FlowPortTone } from './types';

// diagramScene sets text in sans-serif; labels paint blank unless the family is registered.
registerCanvasFont('sans-serif');

const endsOf = (e: { from: string; to: string; label?: string }) =>
  `${e.from}\n${e.to}\n${e.label ?? ''}`;

const COMPASS = ['n', 'e', 's', 'w'] as const;

function labelsOf(node: string, label: (node: string, port: string) => string | null) {
  const out: Record<string, string> = {};
  for (const port of COMPASS) {
    const text = label(node, port);
    if (text !== null) out[port] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface FlowDiagramProps {
  flow: Flow;
  width: number;
  height: number;
  direction?: LayoutDirection;
  minScale?: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Where nodes were dragged to, by id: each stays there, out of the layout's hands. */
  positions?: ReadonlyMap<string, { x: number; y: number }>;
  /** Set to let nodes be dragged; hears each node a drag moved, by its top-left. */
  onMove?: (moves: readonly NodeMove[]) => void;
  /** Set to let a port be dragged onto another; hears the two, in the order dragged. */
  onConnect?: (from: FlowEnd, to: FlowEnd) => void;
  /** Which pairs of ports `onConnect` may hear. Default: any two. */
  canConnect?: (from: FlowEnd, to: FlowEnd) => boolean;
  /** The tone each port of a node is drawn in, by its compass name; null hides it. Default: all
   *  four, in the flow's tone. */
  portTone?: (node: string, port: string) => FlowPortTone | null;
  /** The name drawn beside each port of a node, by its compass name; null draws none. Default: none. */
  portLabel?: (node: string, port: string) => string | null;
  /** Keep every node where it last stood when `flow` changes, laying out only new ones. */
  hold?: boolean;
}

export function FlowDiagram({
  flow,
  width,
  height,
  direction = 'down',
  minScale = 0.75,
  selected,
  onSelect,
  positions,
  onMove,
  onConnect,
  canConnect,
  portTone,
  portLabel,
  hold = false,
}: FlowDiagramProps) {
  const stood = useRef(new Map<string, { x: number; y: number }>());
  const specs = useMemo(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const boxes = new Map((flow.boxes ?? []).map((b) => [b.id, b]));
    const edges = new Map(flow.edges.map((e) => [endsOf(e), e]));
    const built = diagramScene(
      {
        nodes: flow.nodes.map((n) => {
          const at = positions?.get(n.id) ?? (hold ? stood.current.get(n.id) : undefined);
          const labels = portLabel && labelsOf(n.id, portLabel);
          return {
            id: n.id,
            lines: linesOf(n),
            ...(labels ? { portLabels: labels } : {}),
            ...(at ? { at, pinned: true } : {}),
          };
        }),
        edges: flow.edges.map((e) => ({
          from: e.from,
          to: e.to,
          ...(e.label ? { label: e.label } : {}),
        })),
        groups: [...boxes.values()].map((b) => ({ id: b.id, label: b.label, members: b.members })),
      },
      {
        layoutOptions: { direction, order: 'barycenter', nodeGap: 40, rankGap: 56 },
        nodeStyle: (d) => styleOf(byId.get(d.id) as FlowNode),
        groupStyle: (g) => boxStyleOf(boxes.get(g.id) as FlowBox),
        edgeStyle: (e) => edgeStyleOf(edges.get(endsOf(e)) ?? {}),
      },
    );
    stood.current = new Map(
      built.flatMap((x) => (x.id && byId.has(x.id) ? [[x.id, { x: x.pose.x, y: x.pose.y }]] : [])),
    );
    return built;
  }, [flow, direction, positions, hold, portLabel]);
  // DiagramView rebuilds its port layer when these change, so they read the latest props instead.
  const latest = useRef({ canConnect, portTone });
  latest.current = { canConnect, portTone };
  const ports = useMemo<Pick<DiagramViewProps, 'canConnect' | 'portOptions'>>(() => {
    const tone = (p: { nodeId: string; id: string }) =>
      latest.current.portTone ? latest.current.portTone(p.nodeId, p.id) : 'flow';
    return {
      canConnect: (a, b) =>
        !isBodyEnd(a) &&
        !isBodyEnd(b) &&
        (latest.current.canConnect?.(
          { node: a.nodeId, port: a.id },
          { node: b.nodeId, port: b.id },
        ) ??
          a !== b),
      portOptions: {
        shape: 'circle',
        sizePx: 9,
        hitRadiusPx: 10,
        showsPort: (p) => tone(p) !== null,
        fill: (p) => ({ paint: { color: portColorOf(tone(p) ?? 'flow') } }),
      },
    };
  }, []);
  return (
    <DiagramView
      specs={specs}
      width={width}
      height={height}
      minScale={minScale}
      anchor="start"
      selected={selected}
      onSelect={onSelect}
      {...(onMove ? { onMove } : {})}
      {...(onConnect
        ? {
            onConnect: (e) =>
              onConnect(
                { node: e.from, port: e.fromPort ?? '' },
                { node: e.to, port: e.toPort ?? '' },
              ),
            ...ports,
          }
        : {})}
      enableKeybindings={false}
    />
  );
}
