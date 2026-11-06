import type { NumberRule } from '@pg/blits/kit';
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
  | 'query'
  | 'step';
/** Where something is in its life as the mix plays; unset draws it plain. */
export type FlowTone = 'waiting' | 'playing' | 'done';
export interface FlowNode {
  id: string;
  kind: FlowKind;
  label: string;
  /** A word set apart from the name, at the right of its title bar: a voice's patch kind, a group's kind. */
  aside?: string;
  /** Its parameters, each a name then a value, drawn a row apiece under its title bar. */
  params?: readonly (readonly [label: string, value: string])[];
  detail?: string;
  /** The number rule a channel folds by, drawn as its stamp. */
  stamp?: NumberRule;
  /** Named inputs a parameter plugs into, drawn on its side with their names inside it. */
  inputs?: readonly string[];
  /** The weight its stamp is drawn at, 0 to 1. Unset: 1. */
  stampWeight?: number;
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
  /** Sets how the node it enters acts rather than carrying what it acts on, so it meets that node
   *  from the side, off the flow's axis. */
  param?: boolean;
  /** The named input of the node it enters, one of that node's `inputs`. */
  port?: string;
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
/** A port of a node: the node's id and the port's compass name, `n`, `e`, `s` or `w`. */
export interface FlowEnd {
  node: string;
  port: string;
}
/** Which kind of edge a port makes, which it is drawn in the color of. */
export type FlowPortTone = 'flow' | 'timing';
