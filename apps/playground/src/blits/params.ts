import type { Easing, Hit, Placement } from '@msb235/blits';
import type { Expr, Group, Hints, Level, PatchSource, SpanSettings, Voice } from './composition';

/** One parameter as a node shows it: its name, then its value. */
export type Param = readonly [label: string, value: string];

const MAX_VALUE = 24;
const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);
const ms = (n: number) => `${n} ms`;
const easeName = (e: Easing) => (typeof e === 'string' ? e : 'custom');
const code = (e: Expr) => clip(e.code.replace(/\s+/g, ' ').trim());
const placed = (p: Placement[keyof Placement]) =>
  p === undefined ? undefined : typeof p === 'number' ? ms(p) : 'anchored';

/** A voice's `loop` as passes: one pass is the default and says nothing. */
function passes(loop: boolean | number): Param[] {
  if (loop === true) return [['passes', '∞']];
  return typeof loop === 'number' && loop !== 1 ? [['passes', String(loop)]] : [];
}

function patchParams(p: PatchSource): Param[] {
  const out: Param[] = [];
  if (p.kind === 'keys') {
    out.push(['period', ms(p.period)], ['stops', String(p.stops.length)]);
    if (p.ease !== undefined) out.push(['ease', easeName(p.ease)]);
    for (const [ch, e] of Object.entries(p.easeBy ?? {}))
      if (e) out.push([`ease · ${ch}`, easeName(e)]);
    for (const [ch, d] of Object.entries(p.delayBy ?? {}))
      if (d !== undefined) out.push([`delay · ${ch}`, ms(d)]);
  } else if (p.kind === 'fn') {
    out.push(['period', ms(p.period)], ['writes', p.writes.join(', ') || 'nothing']);
    if (p.state !== undefined) out.push(['state', clip(p.state)]);
  } else if (p.kind === 'wave') {
    out.push(['period', ms(p.period)], ['shape', p.shape]);
    if (p.cycles !== 1) out.push(['cycles', String(p.cycles)]);
    if (p.phase !== 0) out.push(['phase', String(p.phase)]);
    for (const [ch, d] of Object.entries(p.depth))
      if (d !== undefined) out.push([`depth · ${ch}`, String(d)]);
  } else {
    out.push(['channel', p.channel]);
    for (const [k, v] of Object.entries(p.opts))
      out.push([k, typeof v === 'object' && !Array.isArray(v) ? code(v) : String(v)]);
    if (p.ease !== undefined) out.push(['ease', easeName(p.ease)]);
  }
  return out;
}

/** What a voice and a group both carry: when, how fast, from where, how it fades and holds. */
function clockParams(x: Voice | Group): Param[] {
  const out: Param[] = [];
  if (x.anchor !== undefined) {
    for (const key of ['start', 'in', 'out', 'end'] as const) {
      const at = placed(x.anchor[key]);
      if (at !== undefined) out.push([key, at]);
    }
  }
  if (x.start !== 0 && x.anchor?.start === undefined) out.push(['start', ms(x.start)]);
  if (x.rate !== 1) out.push(['rate', `${x.rate}×`]);
  if (x.seek !== undefined) out.push(['seek', ms(x.seek)]);
  if (typeof x.weight === 'number' && x.weight !== 1) out.push(['weight', String(x.weight)]);
  if (x.fade.in) out.push(['fade in', ms(x.fade.in)]);
  if (x.fade.out) out.push(['fade out', ms(x.fade.out)]);
  if (x.fade.ease !== undefined) out.push(['fade ease', easeName(x.fade.ease)]);
  if (x.freeze !== undefined) out.push(['freeze', x.freeze]);
  return out;
}

function hintParams(h: Hints | undefined): Param[] {
  if (h === undefined) return [];
  const out: Param[] = [];
  if (h.faster !== undefined) out.push(['faster', `${h.faster}×`]);
  if (h.slower !== undefined) out.push(['slower', `${h.slower}×`]);
  if (h.overlap) out.push(['overlap', 'yes']);
  if (h.ballast) out.push(['ballast', 'yes']);
  if (h.priority !== undefined) out.push(['priority', String(h.priority)]);
  return out;
}

function scoreParams(x: { tags?: string[]; score?: string; hits?: Hit<string>[] }): Param[] {
  const out: Param[] = [];
  if (x.score !== undefined) out.push(['score', x.score]);
  if (x.tags?.length) out.push(['tags', clip(x.tags.join(', '))]);
  for (const h of x.hits ?? []) out.push([`hit · ${h.event}`, ms(h.at)]);
  return out;
}

function spanParams(s: SpanSettings | undefined): Param[] {
  if (s === undefined) return [];
  const out: Param[] = [];
  if (s.duration !== undefined) out.push(['duration', ms(s.duration)]);
  if (s.order !== undefined) out.push(['order', s.order]);
  if (s.share !== undefined) out.push(['share', String(s.share)]);
  if (s.priority !== undefined) out.push(['priority', String(s.priority)]);
  if (s.spill !== undefined) out.push(['spill', s.spill]);
  if (s.fit?.length) out.push(['fit', s.fit.map((f) => f.kind).join(' → ')]);
  return out;
}

/** Every parameter a voice sets away from its default, the patch's first. Its `stagger`, `target`
 *  and `weight` expressions are steps of their own, and its owner an edge, so none is here. */
export function voiceParams(v: Voice, blended: boolean): Param[] {
  const out = [...patchParams(v.patch), ...passes(v.loop), ...clockParams(v)];
  if (v.stepMs !== undefined) out.push(['step', ms(v.stepMs)]);
  if (v.catchUp !== undefined && v.catchUp !== 'exact') out.push(['catch-up', v.catchUp]);
  if (v.role !== undefined) out.push(['role', blended ? `${v.role} (blend)` : v.role]);
  if (v.from !== undefined) out.push(['from', v.from]);
  for (const [name, at] of Object.entries(v.marks ?? {})) out.push([`mark · ${name}`, ms(at)]);
  return [...out, ...hintParams(v.hints), ...scoreParams(v)];
}

/** Every parameter a group sets away from its default, a span's own first. */
export function groupParams(g: Group): Param[] {
  return [...spanParams(g.span), ...clockParams(g), ...hintParams(g.hints), ...scoreParams(g)];
}

export function levelParams(l: Level): Param[] {
  return [
    ['value', String(l.value)],
    ['range', `${l.min}–${l.max}`],
  ];
}

/** Parameters as one line, for a place with room for no more. */
export const paramLine = (params: readonly Param[]) =>
  params.map(([label, value]) => `${label} ${value}`).join(' · ');
