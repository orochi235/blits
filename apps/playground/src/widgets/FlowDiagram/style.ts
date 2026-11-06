import { hueColor } from '@msb235/blits-panel';
import type { NumberRule } from '@pg/blits/kit';
import { stampUrl } from '@pg/widgets/FoldStamp';
import type { EdgeStyle, NodeStyle, Row } from '@weasel-js/diagram';
import type { FlowBox, FlowEdge, FlowKind, FlowNode, FlowPortTone, FlowTone } from './types';

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
  step: '#7ba7c7',
};

/** labkit's control label face: Oswald, upper case, tracked wide. */
const HEADER_FACE = { fontFamily: 'Oswald', fontSize: 11, weight: 400, tracking: 0.06 };

/** Kinds whose label is a name; a signal's or an expression's is its code. */
const NAMED: ReadonlySet<FlowKind> = new Set<FlowKind>([
  'level',
  'group',
  'voice',
  'channel',
  'pose',
  'rest',
  'mark',
  'join',
  'query',
  'step',
]);

/** A stamp's side on a node, and the side it is drawn at, so it stays sharp at twice the scale. */
const STAMP = 48;
const STAMP_DRAWN = 96;

const stampRow = (rule: NumberRule): Row => ({
  kind: 'slot',
  height: STAMP,
  width: STAMP,
  image: { src: stampUrl({ rule, size: STAMP_DRAWN }) },
});

/** A named node's name in its title bar over each line of the detail; any other's label first. */
export function rowsOf(n: FlowNode): Row[] {
  const params = (n.params ?? []).map(([label, value]): Row => ({ kind: 'field', label, value }));
  const lines = (n.detail ? n.detail.split('\n') : []).map(
    (text): Row => ({ kind: 'label', text }),
  );
  const stamp = n.stamp === undefined ? [] : [stampRow(n.stamp)];
  const detail = [...stamp, ...params, ...lines];
  if (!NAMED.has(n.kind)) return [{ kind: 'label', text: n.label }, ...detail];
  const aside = n.aside === undefined ? {} : { aside: n.aside.toUpperCase() };
  return [
    { kind: 'header', text: n.label.toUpperCase(), style: HEADER_FACE, pad: 3, ...aside },
    ...detail,
  ];
}

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
    (n.kind === 'voice' || n.kind === 'group' || n.kind === 'step') && n.hue !== undefined
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

export const portColorOf = (tone: FlowPortTone) => (tone === 'timing' ? TIMING : EDGE);
