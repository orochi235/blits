import type { Placement } from '@msb235/blits';

type Rec = Record<string, unknown>;
const obj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';

const MARKS = ['start', 'in', 'coast', 'out', 'end'];
const RESOLVERS = ['last', 'first', 'next', 'earliest', 'latest'];
const QUERY = ['score', 'name', 'tag', 'writes', 'resolver'];
const SUGAR = ['after', 'with', 'before'];
const MAX_DEPTH = 4;

const extra = (v: Rec, known: readonly string[]) => Object.keys(v).find((k) => !known.includes(k));

function queryFault(q: unknown): string | null {
  if (str(q)) return q === '' ? 'names no voice' : null;
  if (!obj(q)) return 'selects by a name or a query such as {"tag": "lead"}';
  const odd = extra(q, QUERY);
  if (odd !== undefined) return `a query has no "${odd}"`;
  for (const k of QUERY) if (q[k] !== undefined && !str(q[k])) return `a query's ${k} is text`;
  if (q.resolver !== undefined && !RESOLVERS.includes(q.resolver as string))
    return `a resolver is one of ${RESOLVERS.join(', ')}`;
  return null;
}

function anchorFault(a: unknown, depth = 0): string | null {
  if (!obj(a)) return 'an anchor is an object such as {"after": "intro"}';
  const join = 'all' in a ? 'all' : 'any' in a ? 'any' : null;
  if (join) {
    const list = a[join];
    if (extra(a, [join]) !== undefined) return `${join} holds only its list`;
    if (!Array.isArray(list) || list.length === 0) return `${join} takes a list of anchors`;
    if (depth >= MAX_DEPTH) return 'joins nest too deep';
    return list.map((x) => anchorFault(x, depth + 1)).find((f) => f !== null) ?? null;
  }
  if (a.by !== undefined && !num(a.by)) return 'by is a number of ms';
  if ('of' in a) {
    const odd = extra(a, ['of', 'mark', 'by']);
    if (odd !== undefined) return `an anchor has no "${odd}"`;
    if (!MARKS.includes(a.mark as string)) return `mark is one of ${MARKS.join(', ')}`;
    return queryFault(a.of);
  }
  const kind = SUGAR.filter((k) => k in a);
  if (kind.length !== 1) return 'an anchor takes one of of, after, with, before, all, any';
  const odd = extra(a, [kind[0] as string, 'by']);
  if (odd !== undefined) return `an anchor has no "${odd}"`;
  return queryFault(a[kind[0] as string]);
}

/** Why `p` is no blits `Placement`, or null when it is one. */
export function placementFault(p: unknown): string | null {
  if (!obj(p)) return 'a placement is an object such as {"start": {"after": "intro"}}';
  const odd = extra(p, ['start', 'in', 'out', 'end']);
  if (odd !== undefined) return `a placement has start or in, and out or end, not "${odd}"`;
  if (p.start !== undefined && p.in !== undefined) return 'a placement takes one of start and in';
  if (p.out !== undefined && p.end !== undefined) return 'a placement takes one of out and end';
  for (const [k, v] of Object.entries(p)) {
    const fault = num(v) ? null : anchorFault(v);
    if (fault !== null) return `${k}: ${fault}`;
  }
  return null;
}

/** A placement typed as JSON; blank is none. */
export function parsePlacement(text: string): { placement?: Placement } | { error: string } {
  if (text.trim() === '') return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const fault = placementFault(raw);
  if (fault !== null) return { error: fault };
  return Object.keys(raw as Rec).length > 0 ? { placement: raw as Placement } : {};
}

/** Placements to start from, by what each does; `name` is another voice's. */
export const PLACEMENTS: Record<string, (name: string) => Placement> = {
  'start after it ends': (name) => ({ start: { after: name } }),
  'start with it': (name) => ({ start: { with: name } }),
  'start 200 ms before it': (name) => ({ start: { before: name, by: 200 } }),
  'start when its last pass ends': (name) => ({ start: { of: name, mark: 'coast' } }),
  'be fully in 100 ms after it is': (name) => ({ in: { of: name, mark: 'in', by: 100 } }),
  'fade out when it starts': (name) => ({ out: { with: name } }),
  'start at 1 s, be gone by 3 s': () => ({ start: 1000, end: 3000 }),
  'start with the mark "beat"': () => ({ start: { with: 'beat' } }),
  'start after the first voice tagged "lead"': () => ({
    start: { after: { tag: 'lead', resolver: 'first' } },
  }),
  'start after the last voice writing glow': () => ({ start: { after: { writes: 'glow' } } }),
  'start after it and "beat" both': (name) => ({
    start: { all: [{ after: name }, { with: 'beat' }] },
  }),
  'start after it or "beat", whichever is first': (name) => ({
    start: { any: [{ after: name }, { with: 'beat' }] },
  }),
};
