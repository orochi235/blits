import type { NodeStyle } from '@weasel-js/diagram';
import { hueColor } from '../hue';
import type { FlowKind, FlowNode } from './types';

export const FAULT = '#e5484d';
const FILL = '#16222c';
const TEXT = '#dbe7f2';
const STROKE: Record<FlowKind, string> = {
  level: '#5b84d6',
  signal: '#8a63d2',
  expr: '#8a63d2',
  voice: '#7ba7c7',
  channel: '#3f9a52',
  pose: '#c98a1c',
  rest: '#c98a1c',
};

export const linesOf = (n: FlowNode) => (n.detail ? [n.label, n.detail] : [n.label]);

export function styleOf(n: FlowNode): NodeStyle {
  if (n.faulted) return { fill: FILL, text: TEXT, stroke: FAULT, strokeWidth: 3 };
  const stroke = n.kind === 'voice' && n.hue !== undefined ? hueColor(n.hue) : STROKE[n.kind];
  return { fill: FILL, text: TEXT, stroke };
}
