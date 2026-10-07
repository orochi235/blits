import type { Flow, FlowEdge, FlowNode } from '@pg/widgets/FlowDiagram/types';
import { parseExpressionAt } from 'acorn';
import {
  type Composition,
  type Expr,
  isExpr,
  type Level,
  type PatchSource,
  type Voice,
} from './composition';
import { CHANNELS, type ChannelName, KIT } from './kit';
import { subjectsOf } from './stage';

const OPS = new Set(['gate', 'lag', 'peak', 'slew']);
const FIELDS = ['weight', 'stagger', 'target'] as const;
const MAX_LABEL = 28;

type AstNode = { type: string; start: number; end: number; [k: string]: unknown };
const isAst = (v: unknown): v is AstNode =>
  typeof v === 'object' && v !== null && typeof (v as AstNode).type === 'string';

const clip = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
};
const bodyOf = (code: string) => code.replace(/^\s*(\([^)]*\)|\w+)\s*=>\s*/, '');

const calleeOf = (n: AstNode): string | null =>
  n.type === 'CallExpression' && isAst(n.callee) && n.callee.type === 'Identifier'
    ? (n.callee.name as string)
    : null;

function levelNameOf(n: AstNode): string | null {
  if (calleeOf(n) !== 'level') return null;
  const [arg] = n.arguments as AstNode[];
  return arg?.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null;
}

function argText(n: AstNode, code: string): string {
  if (n.type !== 'ObjectExpression') return code.slice(n.start, n.end);
  return (n.properties as AstNode[])
    .map((p) => {
      const key = isAst(p.key) ? code.slice(p.key.start, p.key.end) : '';
      const value = isAst(p.value) ? code.slice(p.value.start, p.value.end) : '';
      return `${key} ${value}`;
    })
    .join(', ');
}

function parse(code: string): AstNode | null {
  try {
    const root = parseExpressionAt(code, 0, { ecmaVersion: 'latest' }) as unknown as AstNode;
    return code.slice(root.end).trim() === '' ? root : null;
  } catch {
    return null;
  }
}

/** The channels a patch writes, in `CHANNELS` order. */
export function writesOf(p: PatchSource): ChannelName[] {
  if (p.kind === 'keys') {
    const seen = new Set(p.stops.flatMap((s) => Object.keys(s.delta)));
    return CHANNELS.filter((c) => seen.has(c));
  }
  if (p.kind === 'fn') return CHANNELS.filter((c) => p.writes.includes(c));
  return [p.channel];
}

function voiceDetail(v: Voice): string {
  const parts: string[] = [v.patch.kind];
  if (v.patch.kind === 'keys' || v.patch.kind === 'fn') parts.push(`${v.patch.period} ms`);
  if (v.loop === true) parts.push('loop');
  else if (typeof v.loop === 'number') parts.push(`×${v.loop}`);
  if (typeof v.weight === 'number') parts.push(`w ${v.weight}`);
  return parts.join(' · ');
}

class Builder {
  readonly nodes = new Map<string, FlowNode>();
  readonly edges = new Map<string, FlowEdge>();
  constructor(private readonly levels: ReadonlyMap<string, Level>) {}

  node(n: FlowNode): string {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    return n.id;
  }

  edge(from: string, to: string, label?: string) {
    const id = `${from}->${to}${label ? `:${label}` : ''}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, from, to, ...(label ? { label } : {}) });
  }

  level(name: string): string {
    const l = this.levels.get(name);
    return this.node({
      id: `level:${name}`,
      kind: 'level',
      label: name,
      ...(l ? { detail: `${l.min}–${l.max}` } : { detail: 'missing: reads 0', faulted: true }),
    });
  }

  /** The node a signal call stands for, or null when `n` is not one. */
  signal(n: AstNode, code: string, path: string): string | null {
    const name = levelNameOf(n);
    if (name !== null) return this.level(name);
    const op = calleeOf(n);
    if (op === null || !OPS.has(op)) return null;
    const parts: string[] = [];
    const inputs: string[] = [];
    for (const [i, arg] of (n.arguments as AstNode[]).entries()) {
      const input = this.signal(arg, code, `${path}.${i}`);
      if (input === null) parts.push(argText(arg, code));
      else inputs.push(input);
    }
    const id = this.node({
      id: `sig:${path}`,
      kind: 'signal',
      label: clip(`${op}(${parts.join(', ')})`),
    });
    for (const input of inputs) this.edge(input, id);
    return id;
  }

  /** Every outermost signal call under `root`. */
  inputs(root: AstNode, code: string, path: string): string[] {
    const found: string[] = [];
    let k = 0;
    const walk = (n: AstNode) => {
      const id = this.signal(n, code, `${path}.${k}`);
      if (id !== null) {
        k++;
        if (!found.includes(id)) found.push(id);
        return;
      }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) for (const c of v) isAst(c) && walk(c);
        else if (isAst(v)) walk(v);
      }
    };
    walk(root);
    return found;
  }

  field(v: Voice, field: (typeof FIELDS)[number], expr: Expr): string {
    const path = `${v.id}:${field}`;
    const root = parse(expr.code);
    const whole = root && this.signal(root, expr.code, `${path}:0`);
    if (whole) return whole;
    const id = this.node({
      id: `expr:${path}`,
      kind: 'expr',
      label: clip(bodyOf(expr.code)),
      ...(root ? {} : { faulted: true }),
    });
    if (root) for (const input of this.inputs(root, expr.code, `${path}:e`)) this.edge(input, id);
    return id;
  }
}

/** The signal flow of a composition: what feeds each voice, what each voice
 *  writes, and how each channel folds into the pose. `faulted` holds the ids
 *  of voices that failed to compile; they are drawn, marked. */
export function flowOf(comp: Composition, faulted: ReadonlySet<string> = new Set()): Flow {
  const b = new Builder(new Map(comp.levels.map((l) => [l.name, l])));
  for (const l of comp.levels) b.level(l.name);
  const written = new Set<ChannelName>();
  const writes: [string, ChannelName][] = [];
  for (const v of comp.voices) {
    const id = b.node({
      id: `voice:${v.id}`,
      kind: 'voice',
      label: v.name,
      detail: voiceDetail(v),
      hue: v.hue,
      ...(faulted.has(v.id) ? { faulted: true } : {}),
    });
    for (const field of FIELDS) {
      const e = v[field];
      if (isExpr(e)) b.edge(b.field(v, field, e), id, field);
    }
    for (const ch of writesOf(v.patch)) {
      written.add(ch);
      writes.push([id, ch]);
    }
  }
  for (const ch of CHANNELS) {
    if (written.has(ch))
      b.node({ id: `ch:${ch}`, kind: 'channel', label: ch, detail: KIT[ch].kind ?? 'custom' });
  }
  for (const [id, ch] of writes) b.edge(id, `ch:${ch}`);
  const subjects = subjectsOf(comp.stage).length;
  b.node({
    id: 'pose',
    kind: 'pose',
    label: 'pose',
    detail: `× ${subjects} ${comp.stage.kind === 'dots' ? 'dots' : 'letters'}`,
  });
  for (const ch of CHANNELS) if (written.has(ch)) b.edge(`ch:${ch}`, 'pose');
  return { nodes: [...b.nodes.values()], edges: [...b.edges.values()] };
}

const restText = (rest: unknown) => (Array.isArray(rest) ? `[${rest.join(', ')}]` : String(rest));

/** What reaches one channel: its ancestors in `flow`, plus the rest it folds
 *  from when it has one. Empty when nothing writes the channel. */
export function foldOf(flow: Flow, ch: ChannelName): Flow {
  const root = `ch:${ch}`;
  if (!flow.nodes.some((n) => n.id === root)) return { nodes: [], edges: [] };
  const keep = new Set([root]);
  const queue = [root];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const e of flow.edges) {
      if (e.to === id && !keep.has(e.from)) {
        keep.add(e.from);
        queue.push(e.from);
      }
    }
  }
  const nodes = flow.nodes.filter((n) => keep.has(n.id));
  const edges = flow.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const rest = KIT[ch].rest;
  if (rest !== undefined) {
    const id = `rest:${ch}`;
    nodes.push({ id, kind: 'rest', label: 'rest', detail: restText(rest) });
    edges.push({ id: `${id}->${root}`, from: id, to: root });
  }
  return { nodes, edges };
}
