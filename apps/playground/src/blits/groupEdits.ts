import type { Composition, Group, Voice } from './composition';
import { groupsFull } from './edit';
import { ancestorsOf, rowsOf } from './groups';
import { withKey, without } from './keyed';

type Member = Voice | Group;

/** `x` fitted to sit under `parent`: a span places it, and only a span reads its hints. */
function placedUnder<T extends Member>(x: T, parent: Group | undefined): T {
  let out = withKey<Member, 'owner'>(x, 'owner', parent?.id);
  if (parent?.kind === 'span') {
    const anchor = out.anchor && without(without(out.anchor, 'start'), 'in');
    out = withKey(
      { ...out, start: 0 },
      'anchor',
      anchor && Object.keys(anchor).length > 0 ? anchor : undefined,
    );
  } else out = withKey(out, 'hints', undefined);
  return out as T;
}

/** Each member of group `id` refitted under it, as it now is; null when a span would hold an owner. */
function refit(c: Composition, id: string): Composition | null {
  const g = c.groups?.find((x) => x.id === id);
  if (!g) return c;
  if (g.kind === 'span' && c.groups?.some((x) => x.owner === id && x.kind === 'owner')) return null;
  const fit = <T extends Member>(x: T) => (x.owner === id ? placedUnder(x, g) : x);
  return { ...c, voices: c.voices.map(fit), groups: c.groups?.map(fit) };
}

/** `voices` put in the order `rowsOf` gives, so they stay in cue order after the tree changes. */
function inCueOrder(c: Composition): Composition {
  const at = new Map(rowsOf(c).map((r, i) => [r.id, i]));
  const voices = [...c.voices].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  return { ...c, voices };
}

let made = 0;
function freshId(c: Composition): string {
  const used = new Set([...c.voices, ...(c.groups ?? [])].map((x) => x.id));
  let id: string;
  do id = `g${++made}`;
  while (used.has(id));
  return id;
}

/** A new empty group of `kind` at the top, or `c` itself when it holds `MAX_GROUPS` already. */
export function addGroup(c: Composition, kind: Group['kind']): Composition {
  if (groupsFull(c)) return c;
  const groups = c.groups ?? [];
  const names = new Set([...c.voices, ...groups].map((x) => x.name));
  let n = groups.length + 1;
  while (names.has(`group ${n}`)) n++;
  const g: Group = {
    id: freshId(c),
    name: `group ${n}`,
    hue: ((c.voices.length + groups.length) * 67 + 31) % 360,
    kind,
    start: 0,
    rate: 1,
    weight: 1,
    fade: {},
    ...(kind === 'span' ? { span: {} } : {}),
  };
  return { ...c, groups: [...groups, g] };
}

/** Group `id` removed; what it held moves up to its parent. */
export function deleteGroup(c: Composition, id: string): Composition {
  const g = c.groups?.find((x) => x.id === id);
  if (!g) return c;
  const parent = c.groups?.find((x) => x.id === g.owner);
  const up = <T extends Member>(x: T) => (x.owner === id ? placedUnder(x, parent) : x);
  const groups = (c.groups ?? []).filter((x) => x.id !== id).map(up);
  return inCueOrder({ ...c, voices: c.voices.map(up), groups });
}

/**
 * Voice or group `id` moved under group `to`, or to the top for null. Refuses (returning `c`) an
 * unknown id, an owner into a span, and a move that would make a cycle.
 */
export function joinGroup(c: Composition, id: string, to: string | null): Composition {
  const target = to === null ? undefined : c.groups?.find((x) => x.id === to);
  if (to !== null && !target) return c;
  const v = c.voices.find((x) => x.id === id);
  const g = v ? undefined : c.groups?.find((x) => x.id === id);
  const self = v ?? g;
  if (!self || (self.owner ?? null) === to) return c;
  if (g && target) {
    if (g.kind === 'owner' && target.kind === 'span') return c;
    if (target.id === g.id || ancestorsOf(c, target.id).some((x) => x.id === g.id)) return c;
  }
  return inCueOrder(
    v
      ? { ...c, voices: c.voices.map((x) => (x.id === id ? placedUnder(x, target) : x)) }
      : { ...c, groups: c.groups?.map((x) => (x.id === id ? placedUnder(x, target) : x)) },
  );
}

/**
 * Group `next` in place of the one with its id. A span keeps its settings and an owner has none;
 * a kind switch refits its members, refused where a span would hold an owner. A changed `owner`
 * goes through `joinGroup`'s rules.
 */
export function setGroup(c: Composition, next: Group): Composition {
  const was = c.groups?.find((x) => x.id === next.id);
  if (!was) return c;
  const g: Group =
    next.kind === 'span' ? { ...next, span: next.span ?? {} } : without(next, 'span');
  const to = g.owner ?? null;
  if (to !== (was.owner ?? null)) {
    const kept: Group = was.owner === undefined ? without(g, 'owner') : { ...g, owner: was.owner };
    const set = setGroup(c, kept);
    const moved = set === c ? c : joinGroup(set, g.id, to);
    return moved === set ? c : moved;
  }
  const parent = c.groups?.find((x) => x.id === g.owner);
  if (g.kind === 'owner' && parent?.kind === 'span') return c;
  const swapped = { ...c, groups: c.groups?.map((x) => (x.id === g.id ? g : x)) };
  return g.kind === was.kind ? swapped : (refit(swapped, g.id) ?? c);
}
