import type { Anchor, Handle, Mark, SpanHandle } from '@msb235/blits';
import type { Clip, ClipEdit, Edge, Hatch, Header, Link } from '@pg/widgets/ScoreLanes';
import type { Built } from './compile';
import { type Composition, type Group, periodOf, type Voice } from './composition';
import { compileExpr, type Scope, scopeOf } from './expr';
import { rowsOf, underSpan } from './groups';
import { without } from './keyed';
import { clockOf, type Placed, placedOf } from './placed';
import type { Subject } from './stage';

const edgeOfMark = (m: Mark): Edge => (m === 'start' || m === 'in' ? 'start' : 'end');

/** When the first subject starts after the voice's start, and how long until the last does. */
function spreadOf(
  v: Voice,
  subjects: readonly Subject[],
  scope: Scope,
): { at: number; ms: number } {
  const none = { at: 0, ms: 0 };
  if (!v.stagger) return none;
  const r = compileExpr<(s: Subject) => number>(v.stagger, scope, 0);
  if ('error' in r) return none;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const d = Number(r.fn(s));
    if (!Number.isFinite(d)) continue;
    first = Math.min(first, d);
    last = Math.max(last, d);
  }
  return Number.isFinite(first) ? { at: first, ms: last - first } : none;
}

const passesOf = (v: Voice) =>
  v.loop === true ? Number.POSITIVE_INFINITY : v.loop === false ? 1 : v.loop;

function freezeOf(v: Voice): Hatch {
  return v.freeze ?? null;
}

/** The voice name and edge an anchor points at, when it selects by name. */
function targetOf(a: number | Anchor | undefined): { name: string; edge: Edge } | null {
  if (a === undefined || typeof a === 'number') return null;
  const name = (q: unknown) => (typeof q === 'string' ? q : (q as { name?: string }).name);
  let n: string | undefined;
  let edge: Edge;
  if ('after' in a) [n, edge] = [name(a.after), 'end'];
  else if ('with' in a) [n, edge] = [name(a.with), 'start'];
  else if ('before' in a) [n, edge] = [name(a.before), 'start'];
  else if ('of' in a) [n, edge] = [name(a.of), edgeOfMark(a.mark)];
  // A join waits on several voices, so it points at no one of them.
  else return null;
  return n ? { name: n, edge } : null;
}

/** The ms one pass lasts on the score and how many there are; a voice at rate 0 or below never ends. */
function lengthOf(period: number, rate: number, passes: number) {
  return rate > 0 ? { pass: period / rate, passes } : { pass: 0, passes: Number.POSITIVE_INFINITY };
}

function clipOf(v: Voice, lane: number, subjects: readonly Subject[], scope: Scope): Clip {
  const freeze = freezeOf(v);
  const spread = spreadOf(v, subjects, scope);
  const clip: Clip = {
    id: v.id,
    lane,
    label: `${v.name} · ${v.patch.kind}`,
    hue: v.hue,
    start: v.start,
    ...lengthOf(periodOf(v.patch) ?? 0, v.rate, passesOf(v)),
    fadeIn: v.fade.in ?? 0,
    fadeOut: v.fade.out ?? 0,
    spread: spread.ms,
    freezeBefore: freeze === 'before' || freeze === 'both',
    freezeAfter: freeze === 'after' || freeze === 'both',
    locked: v.anchor?.start !== undefined || v.anchor?.in !== undefined,
  };
  if (spread.at !== 0) clip.spreadAt = spread.at;
  if (v.locus !== undefined) clip.group = v.locus;
  return clip;
}

/** A span's child as its fit left it: where it starts, how fast it plays, or that it was skipped. */
function fitted(clip: Clip, v: Voice, h: Handle<Subject> | undefined, p: Placed | undefined) {
  clip.locked = true;
  if (!h || p?.start === undefined) return;
  const period = periodOf(v.patch) ?? 0;
  const above = clockOf(h.owner);
  clip.start = p.start;
  if (p.end === p.start && period > 0 && v.rate > 0) {
    clip.skipped = true;
    Object.assign(clip, lengthOf(period, v.rate * above, clip.passes));
    return;
  }
  Object.assign(clip, lengthOf(period, h.rate * above, clip.passes));
  const factor = h.rate / v.rate;
  if (Number.isFinite(factor) && Math.abs(factor - 1) > 1e-9) clip.factor = factor;
}

type Laying = ScoreOptions & { placed?: Map<string, Placed> };

function headerOf(g: Group, lane: number, depth: number, folded: boolean, o: Laying): Header {
  const p = o.placed?.get(g.id);
  const start = p?.start ?? g.start;
  const h: Header = {
    id: g.id,
    lane,
    depth,
    label: `${g.name} · ${g.kind}`,
    hue: g.hue,
    start,
    end: p?.coast ?? p?.end ?? Number.POSITIVE_INFINITY,
    folded,
  };
  if (g.kind !== 'span') return h;
  const handle = o.built?.groupHandles.get(g.id) as SpanHandle<Subject> | undefined;
  const clock = clockOf(handle);
  if (handle && p && clock > 0) {
    const r = handle.result;
    if (Number.isFinite(r.budget)) h.budget = start + r.budget / clock;
    if (r.over > 0) h.over = r.over / clock;
    h.fell = r.fell;
  } else if (g.span?.duration !== undefined && g.rate > 0)
    h.budget = start + g.span.duration / g.rate;
  return h;
}

export interface ScoreOptions {
  /**
   * The composition compiled and never synced, to place what spans hold and each group's extent
   * where blits put them. Without it, everything sits where its own fields say.
   */
  built?: Built;
  /** Groups whose members are hidden. */
  folded?: ReadonlySet<string>;
}

export interface Score {
  clips: Clip[];
  links: Link[];
  headers: Header[];
}

/** The score of `c`: a lane per voice and per group, in `rowsOf` order, less what folds hide. */
export function clipsOf(
  c: Composition,
  subjects: readonly Subject[],
  opts: ScoreOptions = {},
): Score {
  const scope = scopeOf(c.levels);
  const o: Laying = { ...opts, ...(opts.built ? { placed: placedOf(opts.built) } : {}) };
  const voices = new Map(c.voices.map((v) => [v.id, v]));
  const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
  const clips: Clip[] = [];
  const headers: Header[] = [];
  let hideBelow = Number.POSITIVE_INFINITY;
  for (const row of rowsOf(c)) {
    if (row.depth > hideBelow) continue;
    hideBelow = Number.POSITIVE_INFINITY;
    const lane = clips.length + headers.length;
    const g = row.kind === 'group' ? groups.get(row.id) : undefined;
    const v = row.kind === 'voice' ? voices.get(row.id) : undefined;
    if (g) {
      const folded = opts.folded?.has(g.id) ?? false;
      headers.push(headerOf(g, lane, row.depth, folded, o));
      if (folded) hideBelow = row.depth;
    } else if (v) {
      const clip = clipOf(v, lane, subjects, scope);
      if (row.depth > 0) clip.depth = row.depth;
      if (underSpan(c, v.id)) fitted(clip, v, o.built?.handles.get(v.id), o.placed?.get(v.id));
      clips.push(clip);
    }
  }
  const links: Link[] = [];
  for (const v of c.voices) {
    for (const edge of ['start', 'end'] as const) {
      const a =
        edge === 'start' ? (v.anchor?.start ?? v.anchor?.in) : (v.anchor?.end ?? v.anchor?.out);
      const t = targetOf(a);
      const to = t && c.voices.find((x) => x.id !== v.id && x.name === t.name);
      if (t && to) links.push({ from: { clip: v.id, edge }, to: { clip: to.id, edge: t.edge } });
    }
  }
  return { clips, links, headers };
}

function freshLocus(c: Composition): string {
  const used = new Set(c.voices.map((v) => v.locus));
  let n = 1;
  while (used.has(`group ${n}`)) n++;
  return `group ${n}`;
}

/** `edit` applied to voice `v`, or `v` itself when the edit leaves its clip as it was. */
function edited(c: Composition, v: Voice, edit: Exclude<ClipEdit, { kind: 'group' }>): Voice {
  switch (edit.kind) {
    case 'move':
      return edit.start === v.start ? v : { ...v, start: edit.start };
    case 'passes':
      if (edit.passes === passesOf(v)) return v;
      return { ...v, loop: Number.isFinite(edit.passes) ? edit.passes : true };
    case 'fadeIn':
      return edit.ms === (v.fade.in ?? 0) ? v : { ...v, fade: { ...v.fade, in: edit.ms } };
    case 'fadeOut':
      return edit.ms === (v.fade.out ?? 0) ? v : { ...v, fade: { ...v.fade, out: edit.ms } };
    case 'hatch':
      if (edit.hatch === freezeOf(v)) return v;
      return edit.hatch === null ? without(v, 'freeze') : { ...v, freeze: edit.hatch };
    case 'link': {
      const to = c.voices.find((x) => x.id === edit.link.to.clip);
      if (!to || to.id === v.id) return v;
      const [mark, other]: [Mark, Mark] =
        edit.link.from.edge === 'start' ? ['start', 'in'] : ['end', 'out'];
      const now = targetOf(v.anchor?.[mark] ?? v.anchor?.[other]);
      if (now?.name === to.name && now.edge === edit.link.to.edge) return v;
      const anchor: Anchor = edit.link.to.edge === 'end' ? { after: to.name } : { with: to.name };
      return { ...v, anchor: { ...without(v.anchor ?? {}, other), [mark]: anchor } };
    }
  }
}

export function applyEdit(c: Composition, edit: ClipEdit): Composition {
  if (edit.kind === 'group') return regrouped(c, edit.clip, edit.with);
  let changed = false;
  const voices = c.voices.map((v) => {
    if (v.id !== edit.clip) return v;
    const next = edited(c, v, edit);
    changed ||= next !== v;
    return next;
  });
  return changed ? { ...c, voices } : c;
}

/**
 * Voice `id` leaves its group, then joins `other`'s: it takes `other`'s locus, or both take a fresh
 * one when `other` has none. A group left with one voice is dissolved.
 */
function regrouped(c: Composition, id: string, other: string | null): Composition {
  const self = c.voices.find((v) => v.id === id);
  const target = other === null ? undefined : c.voices.find((v) => v.id === other);
  if (!self || (other !== null && (!target || other === id))) return c;
  if (
    target === undefined
      ? self.locus === undefined
      : target.locus !== undefined && self.locus === target.locus
  )
    return c;
  const locus = target ? (target.locus ?? freshLocus(c)) : undefined;
  let voices = c.voices.map((v): Voice => {
    if (v.id !== id && v.id !== target?.id) return v;
    return locus === undefined ? without(v, 'locus') : { ...v, locus };
  });
  const left = self.locus;
  if (left !== undefined && left !== locus) {
    const rest = voices.filter((v) => v.locus === left);
    if (rest.length === 1) voices = voices.map((v) => (v.locus === left ? without(v, 'locus') : v));
  }
  return { ...c, voices };
}
