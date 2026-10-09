import type { Anchor, Mark } from '@msb235/blits';
import type { Clip, ClipEdit, Edge, Hatch, Link } from '@pg/widgets/ScoreLanes';
import { type Composition, periodOf, type Voice } from './composition';
import { compileExpr, type Scope, scopeOf } from './expr';
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

export function clipsOf(
  c: Composition,
  subjects: readonly Subject[],
): { clips: Clip[]; links: Link[] } {
  const scope = scopeOf(c.levels);
  const clips = c.voices.map((v, lane): Clip => {
    const freeze = freezeOf(v);
    const spread = spreadOf(v, subjects, scope);
    const clip: Clip = {
      id: v.id,
      lane,
      label: `${v.name} · ${v.patch.kind}`,
      hue: v.hue,
      start: v.start,
      pass: periodOf(v.patch) ?? 0,
      passes: passesOf(v),
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
  });
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
  return { clips, links };
}

function freshLocus(c: Composition): string {
  const used = new Set(c.voices.map((v) => v.locus));
  let n = 1;
  while (used.has(`group ${n}`)) n++;
  return `group ${n}`;
}

function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const { [key]: _, ...rest } = o;
  return rest;
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
