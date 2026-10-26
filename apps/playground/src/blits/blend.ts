import type { Composition, Expr, Voice } from './composition';

/**
 * What `mix.blend` takes once for all its voices, so every member of a blend holds the same value.
 * A member keeps its own `id`, `hue`, and the `patch`, `name`, `tags`, and `hits` blits lets a
 * `BlendMember` carry; its `weight` is the blend's signal's.
 */
const SHARED = [
  'start',
  'rate',
  'seek',
  'stepMs',
  'catchUp',
  'loop',
  'stagger',
  'target',
  'freeze',
  'fade',
  'from',
  'anchor',
  'owner',
  'hints',
  'score',
] as const satisfies readonly (keyof Voice)[];

export interface Blend {
  role: string;
  by: Expr;
  /** In cue order; the first one's fields are the spec `mix.blend` is given. */
  members: Voice[];
}

/** The blend voice `v` is a member of, if its role is one. */
export function blendOf(c: Composition, v: Pick<Voice, 'role'>): Blend | undefined {
  const by = v.role === undefined ? undefined : c.blends?.[v.role];
  if (v.role === undefined || by === undefined) return undefined;
  return { role: v.role, by, members: c.voices.filter((x) => x.role === v.role) };
}

/** Where member `i` of `n` is the whole blend: its signal's value there. */
export const stopOf = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

/** The first shared field `v` holds differently from `lead`, or null when it matches. */
export function strayOf(lead: Voice, v: Voice): (typeof SHARED)[number] | null {
  return SHARED.find((k) => JSON.stringify(lead[k]) !== JSON.stringify(v[k])) ?? null;
}

const follow = (v: Voice, lead: Voice): Voice => {
  if (strayOf(lead, v) === null) return v;
  const next: Record<string, unknown> = { ...v };
  for (const k of SHARED) {
    if (lead[k] === undefined) delete next[k];
    else next[k] = lead[k];
  }
  return next as unknown as Voice;
};

/** `c` with every blend's members holding voice `from`'s shared fields, and no blend left without voices. */
export function syncBlend(c: Composition, from: string): Composition {
  const lead = c.voices.find((v) => v.id === from);
  const blend = lead && blendOf(c, lead);
  let voices = c.voices;
  if (lead && blend) {
    const next = voices.map((v) => (v.role === lead.role ? follow(v, lead) : v));
    if (next.some((v, i) => v !== voices[i])) voices = next;
  }
  const roles = new Set(voices.map((v) => v.role));
  const kept = Object.entries(c.blends ?? {}).filter(([role]) => roles.has(role));
  const had = c.blends === undefined ? 0 : Object.keys(c.blends).length;
  const emptied = c.blends !== undefined && kept.length === 0;
  if (voices === c.voices && had === kept.length && !emptied) return c;
  const { blends: _, ...rest } = c;
  return { ...rest, voices, ...(kept.length > 0 ? { blends: Object.fromEntries(kept) } : {}) };
}

/** Role `role` blended by `by`, its voices taking the first one's shared fields; undefined unblends it. */
export function setBlend(c: Composition, role: string, by: Expr | undefined): Composition {
  const blends = { ...c.blends };
  if (by === undefined) delete blends[role];
  else blends[role] = by;
  const lead = c.voices.find((v) => v.role === role);
  return syncBlend({ ...c, blends }, lead?.id ?? '');
}

/**
 * `c` with voice `next` in place of the one it edits. A blend it is in follows the edit; one it
 * has just joined gives it the fields its voices already share.
 */
export function withVoice(c: Composition, next: Voice): Composition {
  const was = c.voices.find((v) => v.id === next.id);
  const placed = { ...c, voices: c.voices.map((v) => (v.id === next.id ? next : v)) };
  const joined = was?.role !== next.role;
  const lead = joined ? placed.voices.find((v) => v.role === next.role && v.id !== next.id) : next;
  return syncBlend(placed, (lead ?? next).id);
}
