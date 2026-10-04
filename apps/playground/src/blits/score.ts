import { type Anchor, level, type Placement } from '@msb235/blits';
import type { Clip, ClipEdit, Edge, Hatch, Link } from '@pg/widgets/ScoreLanes';
import type { Composition, Voice } from './composition';
import { compileExpr, type Scope } from './expr';
import type { Subject } from './stage';

type Mark = keyof Placement;
const edgeOfMark = (m: Mark): Edge => (m === 'start' || m === 'in' ? 'start' : 'end');

function spreadOf(v: Voice, subjects: readonly Subject[], scope: Scope): number {
  if (!v.stagger) return 0;
  const r = compileExpr<(s: Subject) => number>(v.stagger, scope, 0);
  if ('error' in r) return 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const s of subjects) {
    const d = Number(r.fn(s));
    if (!Number.isFinite(d)) continue;
    first = Math.min(first, d);
    last = Math.max(last, d);
  }
  return last > first ? last - first : 0;
}

const passesOf = (v: Voice) =>
  v.loop === true ? Number.POSITIVE_INFINITY : v.loop === false ? 1 : v.loop;

function holdOf(v: Voice): Hatch {
  return v.hold ?? null;
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
  else [n, edge] = [name(a.of), edgeOfMark(a.mark)];
  return n ? { name: n, edge } : null;
}

function scopeOf(c: Composition): Scope {
  const levels = new Map(c.levels.map((l) => [l.name, level<Subject>(l.value)]));
  return { level: (name) => levels.get(name) ?? level<Subject>(0) };
}

export function clipsOf(
  c: Composition,
  subjects: readonly Subject[],
): { clips: Clip[]; links: Link[] } {
  const scope = scopeOf(c);
  const clips = c.voices.map((v, lane): Clip => {
    const hold = holdOf(v);
    const clip: Clip = {
      id: v.id,
      lane,
      label: `${v.name} · ${v.patch.kind}`,
      hue: v.hue,
      start: v.start,
      pass: v.patch.kind === 'keys' || v.patch.kind === 'fn' ? v.patch.period : 0,
      passes: passesOf(v),
      fadeIn: v.fade.in ?? 0,
      fadeOut: v.fade.out ?? 0,
      spread: spreadOf(v, subjects, scope),
      holdBefore: hold === 'before' || hold === 'both',
      holdAfter: hold === 'after' || hold === 'both',
      locked: v.anchor?.start !== undefined || v.anchor?.in !== undefined,
    };
    if (v.locus !== undefined) clip.group = v.locus;
    return clip;
  });
  const links: Link[] = [];
  for (const v of c.voices) {
    for (const edge of ['start', 'end'] as const) {
      const a =
        edge === 'start' ? (v.anchor?.start ?? v.anchor?.in) : (v.anchor?.end ?? v.anchor?.out);
      const t = targetOf(a);
      const to = t && c.voices.find((x) => x.name === t.name);
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
function edited(c: Composition, v: Voice, edit: ClipEdit): Voice {
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
      if (edit.hatch === holdOf(v)) return v;
      return edit.hatch === null ? without(v, 'hold') : { ...v, hold: edit.hatch };
    case 'group':
      return v.locus === undefined ? v : without(v, 'locus');
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
  if (edit.kind === 'group' && edit.with !== null) return joined(c, edit.clip, edit.with);
  let changed = false;
  const voices = c.voices.map((v) => {
    if (v.id !== edit.clip) return v;
    const next = edited(c, v, edit);
    changed ||= next !== v;
    return next;
  });
  return changed ? { ...c, voices } : c;
}

/** Voice `id` takes `other`'s locus, or both take a fresh one when `other` has none. */
function joined(c: Composition, id: string, other: string): Composition {
  const target = c.voices.find((v) => v.id === other);
  if (!target || other === id || !c.voices.some((v) => v.id === id)) return c;
  if (target.locus !== undefined && c.voices.find((v) => v.id === id)?.locus === target.locus)
    return c;
  const locus = target.locus ?? freshLocus(c);
  return {
    ...c,
    voices: c.voices.map((v) => (v.id === id || v.id === other ? { ...v, locus } : v)),
  };
}
