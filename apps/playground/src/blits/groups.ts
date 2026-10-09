import type { Composition, Group } from './composition';

export interface Row {
  kind: 'voice' | 'group';
  id: string;
  depth: number;
}

const groupsOf = (c: Composition) => new Map((c.groups ?? []).map((g) => [g.id, g]));

const ownerOf = (c: Composition, id: string): string | undefined =>
  (c.voices.find((v) => v.id === id) ?? c.groups?.find((g) => g.id === id))?.owner;

/** The group a voice or group id sits directly under, or undefined at the top. */
export function parentOf(c: Composition, id: string): Group | undefined {
  const owner = ownerOf(c, id);
  return owner === undefined ? undefined : groupsOf(c).get(owner);
}

/** True when `id` (voice or group) sits directly under a span. */
export const underSpan = (c: Composition, id: string): boolean => parentOf(c, id)?.kind === 'span';

/** Every group from the top down to the one holding `id`, outermost first. */
export function ancestorsOf(c: Composition, id: string): Group[] {
  const groups = groupsOf(c);
  const out: Group[] = [];
  let g = parentOf(c, id);
  while (g && !out.includes(g)) {
    out.unshift(g);
    g = g.owner ? groups.get(g.owner) : undefined;
  }
  return out;
}

/** A cycle in `owner` links, or an unknown `owner` id, as a message; null when the tree is sound. */
export function treeFault(c: Composition): string | null {
  const groups = groupsOf(c);
  for (const x of [...c.voices, ...(c.groups ?? [])])
    if (x.owner !== undefined && !groups.has(x.owner))
      return `"${x.name}" names an unknown group "${x.owner}"`;
  for (const g of groups.values()) {
    const seen = new Set<string>();
    for (let at: Group | undefined = g; at; at = at.owner ? groups.get(at.owner) : undefined) {
      if (seen.has(at.id)) return `group "${g.name}" is in a cycle`;
      seen.add(at.id);
    }
  }
  return null;
}

/**
 * The score's and the cue's order: depth-first, a group just before its first member, groups with
 * no members at the end. Each row is a voice or a group with its depth (0 at the top).
 */
export function rowsOf(c: Composition): Row[] {
  const groups = groupsOf(c);
  const kids = new Map<string | undefined, Omit<Row, 'depth'>[]>();
  const placed = new Set<string>();
  const place = (kind: Row['kind'], id: string, owner: string | undefined) => {
    if (placed.has(id)) return;
    placed.add(id);
    const parent = owner !== undefined && groups.has(owner) ? owner : undefined;
    const list = kids.get(parent) ?? [];
    kids.set(parent, list);
    list.push({ kind, id });
    if (parent !== undefined) place('group', parent, groups.get(parent)?.owner);
  };
  for (const v of c.voices) place('voice', v.id, v.owner);
  for (const g of groups.values()) place('group', g.id, g.owner);

  const rows: Row[] = [];
  const emit = (parent: string | undefined, depth: number) => {
    for (const k of kids.get(parent) ?? []) {
      rows.push({ ...k, depth });
      if (k.kind === 'group') emit(k.id, depth + 1);
    }
  };
  emit(undefined, 0);
  return rows;
}
