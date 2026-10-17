import type { Anchor, Handle, Mark, MarkName, Query } from '@msb235/blits';
import type { Flow, FlowBox, FlowEdge, FlowNode, FlowTone } from '@pg/widgets/FlowDiagram/types';
import type { Built } from './compile';
import type { Composition, Group, Voice } from './composition';
import { writesOf } from './flow';
import { rowsOf, treeFault } from './groups';

type Slot = 'start' | 'in' | 'out' | 'end';
const SLOTS: readonly Slot[] = ['start', 'in', 'out', 'end'];

export interface TimingEdge extends FlowEdge {
  /** The mark of `from` it waits on: one of its five, or one placed inside it. */
  mark: MarkName;
  /** What of `to` it sets: one of its marks, or its turn in a span. Unset into a join or a query. */
  sets?: Slot | 'turn';
}
export interface Timing extends Flow {
  edges: TimingEdge[];
  boxes: FlowBox[];
}

type Item = Voice | Group;
type Leaf = Exclude<Anchor, { all: unknown } | { any: unknown }>;
const isVoice = (x: Item): x is Voice => 'patch' in x;
const nodeOf = (x: Item) => `${isVoice(x) ? 'voice' : 'group'}:${x.id}`;
const ms = (n: number) => `${n} ms`;
const moved = (by: number | undefined) => (by ? ` ${by > 0 ? '+' : '−'}${ms(Math.abs(by))}` : '');

/** Whom a one-voice anchor asks, the mark it waits on, and how an edge says so. */
function leafOf(a: Leaf): { q: string | Query; mark: MarkName; text: string } {
  if ('after' in a) return { q: a.after, mark: 'end', text: `after${moved(a.by)}` };
  if ('with' in a) return { q: a.with, mark: 'start', text: `with${moved(a.by)}` };
  if ('before' in a)
    return { q: a.before, mark: 'start', text: a.by ? `${ms(a.by)} before` : 'before' };
  return { q: a.of, mark: a.mark, text: `its ${a.mark}${moved(a.by)}` };
}

function queryText(q: Query): string {
  const parts: string[] = [];
  if (q.name) parts.push(`named ${q.name}`);
  if (q.tag) parts.push(`tagged ${q.tag}`);
  if (q.writes) parts.push(`writing ${q.writes}`);
  if (q.score) parts.push(`in ${q.score}`);
  return `${q.resolver ?? 'last'} ${parts.join(', ')}`;
}

/** A fixed time on each mark a placement gives as a number. */
const FIXED: Record<Slot, (t: number) => string> = {
  start: (t) => `at ${ms(t)}`,
  in: (t) => `in by ${ms(t)}`,
  out: (t) => `out at ${ms(t)}`,
  end: (t) => `gone by ${ms(t)}`,
};

class Builder {
  readonly nodes = new Map<string, FlowNode>();
  readonly edges = new Map<string, TimingEdge>();
  private readonly named: Map<string, Item>;
  constructor(private readonly c: Composition) {
    this.named = new Map([...c.voices, ...(c.groups ?? [])].map((x) => [x.name, x]));
  }

  node(n: FlowNode): string {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    return n.id;
  }

  edge(e: Omit<TimingEdge, 'id'>) {
    const id = `${e.from}->${e.to}${e.label ? `:${e.label}` : ''}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, ...e });
  }

  mark(name: string): string {
    const said = this.c.announced?.find((a) => a.name === name);
    return this.node({
      id: `mark:${name}`,
      kind: 'mark',
      label: name,
      detail: said ? `announced at ${ms(said.at)}` : 'when the host announces it',
    });
  }

  /** The node `asker`'s anchor waits on for `q`: a voice, a group, a mark, or a query over voices. */
  source(q: string | Query, asker: Item, mark: MarkName, path: string): string {
    const score = (typeof q === 'string' ? undefined : q.score) ?? (asker as Voice).score;
    const within = (x: Item) => !isVoice(x) || x.score === score;
    const plain = typeof q === 'string' || (!q.tag && !q.writes && !q.resolver);
    const name = typeof q === 'string' ? q : q.name;
    if (plain && name !== undefined) {
      const x = this.named.get(name);
      return x && x !== asker && within(x) ? nodeOf(x) : this.mark(name);
    }
    const query = q as Query;
    const found = this.c.voices.filter(
      (v) =>
        v !== asker &&
        within(v) &&
        (query.name === undefined || v.name === query.name) &&
        (query.tag === undefined || (v.tags ?? []).includes(query.tag)) &&
        (query.writes === undefined || (writesOf(v.patch) as string[]).includes(query.writes)),
    );
    const id = this.node({
      id: `query:${path}`,
      kind: 'query',
      label: queryText(query),
      ...(found.length === 0 ? { detail: 'no voice yet' } : {}),
    });
    for (const v of found) this.edge({ from: nodeOf(v), to: id, mark, dashed: true });
    return id;
  }

  /** Draws anchor `a` into `to`; `sets` is the mark of `to` it places, unset into a join. */
  anchor(a: Anchor, asker: Item, to: string, path: string, sets?: Slot) {
    const said = (text: string) => (sets ? `${sets} ${text}` : text);
    const join = 'all' in a ? 'all' : 'any' in a ? 'any' : null;
    if (join) {
      const id = this.node({ id: `join:${path}`, kind: 'join', label: join });
      const list = (a as Record<string, readonly Anchor[]>)[join] ?? [];
      for (const [i, x] of list.entries()) this.anchor(x, asker, id, `${path}.${i}`);
      this.edge({
        from: id,
        to,
        mark: 'start',
        ...(sets ? { sets, label: sets } : {}),
      });
      return;
    }
    const leaf = leafOf(a as Leaf);
    const from = this.source(leaf.q, asker, leaf.mark, path);
    this.edge({ from, to, mark: leaf.mark, label: said(leaf.text), ...(sets ? { sets } : {}) });
  }
}

function groupText(g: Group): string {
  const parts = [g.name, g.kind];
  if (g.span?.duration !== undefined) parts.push(ms(g.span.duration));
  if (g.kind === 'span') parts.push(g.span?.order ?? 'queue');
  return parts.join(' · ');
}

/**
 * What waits on what in a composition: an edge from each voice, group or announced mark an anchor
 * names to what it places, through a node per `all` or `any` and per query that selects among
 * voices; a box per owner and span around what it holds; and a dashed edge from each child of a
 * span to the next, where its order makes one wait. `faulted` holds the ids of voices and groups
 * that failed to compile.
 */
export function timingOf(c: Composition, faulted: ReadonlySet<string> = new Set()): Timing {
  const b = new Builder(c);
  const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
  const kids = new Map<string, string[]>();
  const spanned = new Set<string>();
  if (treeFault(c) === null) {
    const above: string[] = [];
    for (const row of rowsOf(c)) {
      above.length = row.depth;
      const parent = above.at(-1);
      const id = `${row.kind}:${row.id}`;
      if (parent !== undefined) {
        kids.set(parent, [...(kids.get(parent) ?? []), id]);
        if (groups.get(parent)?.kind === 'span') spanned.add(row.id);
      }
      if (row.kind === 'group') above.push(row.id);
    }
  }

  const boxes: FlowBox[] = [];
  for (const g of groups.values()) {
    const members = kids.get(g.id);
    const mark = faulted.has(g.id) ? { faulted: true } : {};
    if (members) boxes.push({ id: nodeOf(g), label: groupText(g), members, hue: g.hue, ...mark });
    else
      b.node({ id: nodeOf(g), kind: 'group', label: g.name, detail: g.kind, hue: g.hue, ...mark });
  }
  for (const v of c.voices) {
    const parts: string[] = [];
    const a = v.anchor ?? {};
    if (a.start === undefined && a.in === undefined && !spanned.has(v.id))
      parts.push(FIXED.start(v.start));
    for (const slot of SLOTS) {
      const at = a[slot];
      if (typeof at === 'number') parts.push(FIXED[slot](at));
    }
    if (v.locus !== undefined) parts.push(`locus ${v.locus}`);
    b.node({
      id: nodeOf(v),
      kind: 'voice',
      label: v.name,
      ...(parts.length ? { detail: parts.join(' · ') } : {}),
      hue: v.hue,
      ...(faulted.has(v.id) ? { faulted: true } : {}),
    });
  }

  for (const x of [...groups.values(), ...c.voices]) {
    for (const slot of SLOTS) {
      const a = x.anchor?.[slot];
      if (a !== undefined && typeof a !== 'number')
        b.anchor(a, x, nodeOf(x), `${x.id}:${slot}`, slot);
    }
  }

  for (const g of groups.values()) {
    const order = g.span?.order ?? 'queue';
    const members = kids.get(g.id) ?? [];
    if (g.kind !== 'span' || order === 'together') continue;
    const label = order === 'queue' ? 'then' : `${Math.round((g.span?.share ?? 0.5) * 100)}% in`;
    for (const [i, to] of members.entries()) {
      const from = members[i - 1];
      if (from !== undefined)
        b.edge({
          from,
          to,
          label,
          mark: order === 'queue' ? 'end' : 'start',
          sets: 'turn',
          dashed: true,
        });
    }
  }
  return { nodes: [...b.nodes.values()], edges: [...b.edges.values()], boxes };
}

export type Phase = Handle<unknown>['state'];

/**
 * What a running mix says of a composition: each voice's and group's state by id, the marks
 * announced so far, and whether a voice or group has reached a mark placed inside it.
 */
export interface Live {
  phaseOf(id: string): Phase | undefined;
  heard: ReadonlySet<string>;
  passed(id: string, mark: string): boolean | undefined;
}

/** `built`'s full mix as it stands, with `host` the time it was last synced to. */
export function liveOf(built: Built, host: number): Live {
  const heard = new Set<string>();
  const inner = new Set<string>();
  for (const m of built.mix.marks(Number.NEGATIVE_INFINITY, host)) {
    if (m.timestamp > host) continue;
    if (m.voice === undefined && m.name !== undefined) heard.add(m.name);
    else if (m.voice !== undefined && m.mark !== undefined && !Object.hasOwn(PAST, m.mark))
      inner.add(`${m.voice}\u0000${m.mark}`);
  }
  const handleOf = (id: string) => built.handles.get(id) ?? built.groupHandles.get(id);
  return {
    phaseOf: (id) => handleOf(id)?.state,
    heard,
    passed: (id, mark) => {
      const h = handleOf(id);
      return h === undefined ? undefined : inner.has(`${h.id}\u0000${mark}`);
    },
  };
}

const TONE: Record<Phase, FlowTone> = {
  pending: 'waiting',
  live: 'playing',
  frozen: 'playing',
  fading: 'playing',
  done: 'done',
};

const PAST: Record<Mark, readonly Phase[]> = {
  start: ['live', 'frozen', 'fading', 'done'],
  in: ['live', 'frozen', 'fading', 'done'],
  coast: ['frozen', 'fading', 'done'],
  out: ['fading', 'done'],
  end: ['done'],
};

/**
 * `t` as the mix stands: each voice and group toned by its state, and each edge met or not. An
 * edge that sets a mark is met when its voice has passed that mark, which is exact; one into a
 * join or a query is met when its source's state says the awaited mark is behind it.
 */
export function lit(t: Timing, live: Live): Flow {
  const phase = (node: string) =>
    node.startsWith('voice:') || node.startsWith('group:')
      ? live.phaseOf(node.slice(node.indexOf(':') + 1))
      : undefined;
  const kind = new Map(t.nodes.map((n) => [n.id, n]));
  const into = (node: string) => t.edges.filter((e) => e.to === node);
  const reached = (node: string, mark: MarkName): boolean | undefined => {
    const n = kind.get(node);
    if (n?.kind === 'mark') return live.heard.has(n.label);
    if (n?.kind === 'query') return into(node).some((e) => reached(e.from, mark) === true);
    if (n?.kind === 'join') {
      const each = into(node).map((e) => reached(e.from, e.mark) === true);
      return n.label === 'all' ? each.every(Boolean) : each.some(Boolean);
    }
    if (!Object.hasOwn(PAST, mark))
      return node.startsWith('voice:') || node.startsWith('group:')
        ? live.passed(node.slice(node.indexOf(':') + 1), mark)
        : undefined;
    const p = phase(node);
    return p === undefined ? undefined : PAST[mark as Mark].includes(p);
  };
  const met = (e: TimingEdge): boolean | undefined => {
    if (e.sets === undefined) return reached(e.from, e.mark);
    const p = phase(e.to);
    if (p === undefined) return undefined;
    return PAST[e.sets === 'turn' || e.sets === 'in' ? 'start' : e.sets].includes(p);
  };
  const toned = <T extends { id: string }>(x: T): T => {
    const p = phase(x.id);
    return p === undefined ? x : { ...x, tone: TONE[p] };
  };
  return {
    nodes: t.nodes.map(toned),
    boxes: t.boxes.map(toned),
    edges: t.edges.map((edge) => {
      const { mark: _mark, sets: _sets, ...e } = edge;
      const m = met(edge);
      return m === undefined ? e : { ...e, met: m };
    }),
  };
}
