export type FlowKind =
  | 'level'
  | 'signal'
  | 'expr'
  | 'group'
  | 'voice'
  | 'channel'
  | 'pose'
  | 'rest';
export interface FlowNode {
  id: string;
  kind: FlowKind;
  label: string;
  detail?: string;
  hue?: number;
  faulted?: boolean;
}
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}
export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
