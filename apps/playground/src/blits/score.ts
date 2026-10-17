import type { Anchor, Mark, Query } from '@msb235/blits';
import type { Clip, ClipEdit, Edge, Header, Link, ScoreMark } from '@pg/widgets/ScoreLanes';
import { blendOf, syncBlend } from './blend';
import { clipOf, freezeOf, passesOf, placeFrom, playOf, startsPartway, stopsOf } from './clip';
import type { Built } from './compile';
import { type Composition, periodOf, type Voice } from './composition';
import { scopeOf } from './expr';
import { rowsOf, underSpan } from './groups';
import { without } from './keyed';
import { clockOf, placedOf } from './placed';
import { cutUnder, headerOf, type Laying } from './scoreHeaders';
import type { Subject } from './stage';
import { timingOf } from './timing';

const edgeOfMark = (m: Mark): Edge => (m === 'start' || m === 'in' ? 'start' : 'end');

/** The voice name and edge an anchor points at, when it selects by name alone. */
function targetOf(a: number | Anchor | undefined): { name: string; edge: Edge } | null {
  if (a === undefined || typeof a === 'number') return null;
  const name = (q: unknown) => {
    if (typeof q === 'string') return q;
    const x = q as Query;
    return x.tag || x.writes || x.resolver ? undefined : x.name;
  };
  let n: string | undefined;
  let edge: Edge;
  if ('after' in a) [n, edge] = [name(a.after), 'end'];
  else if ('with' in a) [n, edge] = [name(a.with), 'start'];
  else if ('before' in a) [n, edge] = [name(a.before), 'start'];
  else if ('of' in a) [n, edge] = [name(a.of), edgeOfMark(a.mark)];
  // A join waits on several voices, so it points at no one of them; `joinedLinks` draws those.
  else return null;
  return n ? { name: n, edge } : null;
}

export interface ScoreOptions {
  /**
   * The composition compiled and never synced, to place every clip and each group's extent where
   * blits put them. Without it, everything sits where its own fields say.
   */
  built?: Built;
  /** Groups whose members are hidden. */
  folded?: ReadonlySet<string>;
}

export interface Score {
  clips: Clip[];
  links: Link[];
  headers: Header[];
  /** The marks the composition announces. */
  marks: ScoreMark[];
}

/** The score of `c`: a lane per voice and per group, in `rowsOf` order, less what folds hide. */
export function clipsOf(
  c: Composition,
  subjects: readonly Subject[],
  opts: ScoreOptions = {},
): Score {
  const scope = scopeOf(c.levels);
  const o: Laying = opts.built ? { built: opts.built, placed: placedOf(opts.built) } : {};
  const voices = new Map(c.voices.map((v) => [v.id, v]));
  const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
  const clips: Clip[] = [];
  const headers: Header[] = [];
  let hideBelow = Number.POSITIVE_INFINITY;
  const above: Header[] = [];
  for (const row of rowsOf(c)) {
    if (row.depth > hideBelow) continue;
    hideBelow = Number.POSITIVE_INFINITY;
    while ((above.at(-1)?.depth ?? -1) >= row.depth) above.pop();
    const lane = clips.length + headers.length;
    const g = row.kind === 'group' ? groups.get(row.id) : undefined;
    const v = row.kind === 'voice' ? voices.get(row.id) : undefined;
    if (g) {
      const folded = opts.folded?.has(g.id) ?? false;
      const header = headerOf(g, lane, row.depth, folded, o);
      headers.push(header);
      above.push(header);
      if (folded) hideBelow = row.depth;
    } else if (v) {
      const h = o.built?.handles.get(v.id);
      const p = o.placed?.get(v.id);
      const clip = clipOf(v, lane, subjects, scope, h ? clockOf(h) : v.rate);
      if (row.depth > 0) clip.depth = row.depth;
      if (underSpan(c, v.id)) clip.locked = true;
      if (blendOf(c, v)) clip.label += ' · blend';
      if (h && p) placeFrom(clip, v, h, p);
      const cut = cutUnder(above);
      if (cut) clip.cut = cut;
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
  links.push(...joinedLinks(c));
  const marks = (c.announced ?? []).map((a) => ({ at: a.at, label: a.name }));
  return { clips, links, headers, marks };
}

/**
 * A link from each voice an `all`, an `any`, or a query anchor could wait on, as the Timing tab
 * resolves them: `all` when every step from the anchor to that voice is an `all`, else `any`.
 */
function joinedLinks(c: Composition): Link[] {
  const t = timingOf(c);
  const kinds = new Map(t.nodes.map((n) => [n.id, n]));
  const into = new Map<string, typeof t.edges>();
  for (const e of t.edges) into.set(e.to, [...(into.get(e.to) ?? []), e]);
  const out = new Map<string, Link>();
  const walk = (node: string, from: Link['from'], all: boolean) => {
    const n = kinds.get(node);
    const every = all && n?.kind === 'join' && n.label === 'all';
    for (const e of into.get(node) ?? []) {
      if (e.from.startsWith('voice:')) {
        const to = { clip: e.from.slice('voice:'.length), edge: edgeOfMark(e.mark) };
        const key = `${from.clip}.${from.edge}-${to.clip}.${to.edge}`;
        if (to.clip !== from.clip && !out.has(key))
          out.set(key, { from, to, join: every ? 'all' : 'any' });
      } else if (e.from.startsWith('join:') || e.from.startsWith('query:'))
        walk(e.from, from, every);
    }
  };
  for (const v of c.voices)
    for (const e of into.get(`voice:${v.id}`) ?? []) {
      if (e.sets === undefined || e.sets === 'turn') continue;
      if (!e.from.startsWith('join:') && !e.from.startsWith('query:')) continue;
      const edge: Edge = e.sets === 'start' || e.sets === 'in' ? 'start' : 'end';
      walk(e.from, { clip: v.id, edge }, true);
    }
  return [...out.values()];
}

function freshLocus(c: Composition): string {
  const used = new Set(c.voices.map((v) => v.locus));
  let n = 1;
  while (used.has(`group ${n}`)) n++;
  return `group ${n}`;
}

/** `edit` applied to voice `v`, or `v` itself when the edit leaves its clip as it was. */
function edited(
  c: Composition,
  v: Voice,
  edit: Exclude<ClipEdit, { kind: 'group' }>,
  built: Built | undefined,
): Voice {
  switch (edit.kind) {
    case 'move': {
      if (underSpan(c, v.id)) return v;
      const start = startOf(v, edit.start, built);
      return start === v.start ? v : { ...v, start };
    }
    case 'passes': {
      if (!startsPartway(v)) {
        if (edit.passes === passesOf(v)) return v;
        return { ...v, loop: Number.isFinite(edit.passes) ? edit.passes : true };
      }
      // Its clip shows what is left to play, so the loop is the fewest that leave that much.
      const left = playOf(periodOf(v.patch) ?? 0, v.rate, passesOf(v), v.seek).passes;
      if (edit.passes === left) return v;
      const stop = stopsOf(v).find((s) => Math.abs(s.passes - edit.passes) < 1e-9);
      return stop && stop.loop !== v.loop ? { ...v, loop: stop.loop } : v;
    }
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
      if (edit.link.from.edge === 'start' && underSpan(c, v.id)) return v;
      const [mark, other]: [Mark, Mark] =
        edit.link.from.edge === 'start' ? ['start', 'in'] : ['end', 'out'];
      const now = targetOf(v.anchor?.[mark] ?? v.anchor?.[other]);
      if (now?.name === to.name && now.edge === edit.link.to.edge) return v;
      const anchor: Anchor = edit.link.to.edge === 'end' ? { after: to.name } : { with: to.name };
      return { ...v, anchor: { ...without(v.anchor ?? {}, other), [mark]: anchor } };
    }
  }
}

/**
 * The `start` a clip moved to score ms `to` gives voice `v`: the move from where `built` drew it,
 * on the voice's owner's clock.
 */
function startOf(v: Voice, to: number, built: Built | undefined): number {
  const h = built?.handles.get(v.id);
  const drawn = h && built ? placedOf(built).get(v.id)?.start : undefined;
  if (!h || drawn === undefined) return to;
  return Math.max(0, v.start + (to - drawn) * clockOf(h.owner));
}

/** `edit` applied to `c`; `built` is the build `clipsOf` drew from, so a move is read as it was. */
export function applyEdit(c: Composition, edit: ClipEdit, built?: Built): Composition {
  if (edit.kind === 'group')
    return syncBlend(regrouped(c, edit.clip, edit.with), edit.with ?? edit.clip);
  let changed = false;
  const voices = c.voices.map((v) => {
    if (v.id !== edit.clip) return v;
    const next = edited(c, v, edit, built);
    changed ||= next !== v;
    return next;
  });
  return changed ? syncBlend({ ...c, voices }, edit.clip) : c;
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
