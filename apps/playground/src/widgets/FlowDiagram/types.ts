export type FlowKind =
  | 'level'
  | 'signal'
  | 'expr'
  | 'group'
  | 'voice'
  | 'channel'
  | 'pose'
  | 'rest'
  | 'mark'
  | 'join'
  | 'query';
/** Where something is in its life as the mix plays; unset draws it plain. */
export type FlowTone = 'waiting' | 'playing' | 'done';
export interface FlowNode {
  id: string;
  kind: FlowKind;
  label: string;
  detail?: string;
  hue?: number;
  faulted?: boolean;
  tone?: FlowTone;
}
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  /** Drawn in the timing color, apart from the flow's edges. */
  timing?: boolean;
  /** Whether what it waits on has happened; unset draws it plain. */
  met?: boolean;
}
/** A box around nodes and other boxes, by id; an edge may name it as an end. */
export interface FlowBox {
  id: string;
  label: string;
  members: string[];
  hue?: number;
  faulted?: boolean;
  tone?: FlowTone;
}
export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
  boxes?: FlowBox[];
}
