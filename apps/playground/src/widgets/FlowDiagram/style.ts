import type { EdgeStyle, NodeStyle } from '@weasel-js/diagram';
import { hueColor } from '../hue';
import type { FlowBox, FlowEdge, FlowKind, FlowNode, FlowTone } from './types';

export const FAULT = '#e5484d';
const FILL = '#16222c';
const LIT = '#24394a';
const TEXT = '#dbe7f2';
const FAINT = '#6f8496';
const EDGE = '#7ba7c7';
const UNMET = '#45596a';
const TIMING = '#d9a04a';
const TIMING_UNMET = '#6b5532';
const DASH = [4, 3];
const STROKE: Record<FlowKind, string> = {
  level: '#5b84d6',
  signal: '#8a63d2',
  expr: '#8a63d2',
  group: '#7ba7c7',
  voice: '#7ba7c7',
  channel: '#3f9a52',
  pose: '#c98a1c',
  rest: '#c98a1c',
  mark: '#c98a1c',
  join: '#8a63d2',
  query: '#8a63d2',
};

/** The label, then each line of the detail. */
export const linesOf = (n: FlowNode) => (n.detail ? [n.label, ...n.detail.split('\n')] : [n.label]);

/** What a tone does to a box that is otherwise `plain`. */
function toned(plain: NodeStyle, tone: FlowTone | undefined): NodeStyle {
  if (tone === 'waiting') return { ...plain, text: FAINT, dash: DASH };
  if (tone === 'playing') return { ...plain, fill: LIT, strokeWidth: 3 };
  if (tone === 'done') return { ...plain, text: FAINT, stroke: UNMET };
  return plain;
}

export function styleOf(n: FlowNode): NodeStyle {
  if (n.faulted) return { fill: FILL, text: TEXT, stroke: FAULT, strokeWidth: 3 };
  const stroke =
    (n.kind === 'voice' || n.kind === 'group') && n.hue !== undefined
      ? hueColor(n.hue)
      : STROKE[n.kind];
  return toned({ fill: FILL, text: TEXT, stroke }, n.tone);
}

export function boxStyleOf(b: FlowBox): NodeStyle {
  const fill = 'rgba(123, 167, 199, 0.08)';
  if (b.faulted) return { fill, text: TEXT, stroke: FAULT, strokeWidth: 3 };
  const stroke = b.hue !== undefined ? hueColor(b.hue) : STROKE.group;
  const plain = toned({ fill, text: TEXT, stroke, strokeWidth: 1 }, b.tone);
  return b.tone === 'playing' ? { ...plain, fill: 'rgba(123, 167, 199, 0.16)' } : plain;
}

export function edgeStyleOf(e: Pick<FlowEdge, 'dashed' | 'met' | 'timing'>): EdgeStyle {
  const [lit, unmet] = e.timing ? [TIMING, TIMING_UNMET] : [EDGE, UNMET];
  return {
    stroke: e.met === false ? unmet : lit,
    ...(e.met === true ? { width: 2 } : {}),
    ...(e.dashed ? { dash: DASH } : {}),
  };
}
