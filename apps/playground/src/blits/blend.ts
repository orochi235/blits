import type { Composition, Expr, Voice } from './composition';

/**
 * What `mix.blend` takes once for all its voices, so every member of a blend holds the same value.
 * A member keeps its own `id`, `name`, `hue`, and `patch`; its `weight` is the blend's signal's.
 */
const SHARED = [
  'start',
  'rate',
  'loop',
  'stagger',
  'target',
  'freeze',
  'fade',
  'from',
  'anchor',
  'owner',
  'hints',
  'tags',
  'score',
  'hits',
] as const satisfies readonly (keyof Voice)[];

export interface Blend {
  locus: string;
  by: Expr;
  /** In cue order; the first one's fields are the spec `mix.blend` is given. */
  members: Voice[];
}

/** The blend voice `v` is a member of, if its locus is one. */
export function blendOf(c: Composition, v: Pick<Voice, 'locus'>): Blend | undefined {
  const by = v.locus === undefined ? undefined : c.blends?.[v.locus];
  if (v.locus === undefined || by === undefined) return undefined;
  return { locus: v.locus, by, members: c.voices.filter((x) => x.locus === v.locus) };
}

/** Where member `i` of `n` is the whole blend: its signal's value there. */
export const stopOf = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

/**
 * Member `i` of `n`'s share of a blend whose signal reads `k`. blits keeps this to itself, and a
 * solo mix needs it to play one member with the others silent.
 */
export function shareOf(k: number, i: number, n: number): number {
  const d = n > 1 ? Math.abs(k * (n - 1) - i) : 0;
  return d >= 1 ? 0 : 1 - d;
}

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
    const next = voices.map((v) => (v.locus === lead.locus ? follow(v, lead) : v));
    if (next.some((v, i) => v !== voices[i])) voices = next;
  }
  const loci = new Set(voices.map((v) => v.locus));
  const kept = Object.entries(c.blends ?? {}).filter(([locus]) => loci.has(locus));
  const had = c.blends === undefined ? 0 : Object.keys(c.blends).length;
  const emptied = c.blends !== undefined && kept.length === 0;
  if (voices === c.voices && had === kept.length && !emptied) return c;
  const { blends: _, ...rest } = c;
  return { ...rest, voices, ...(kept.length > 0 ? { blends: Object.fromEntries(kept) } : {}) };
}

/** Locus `locus` blended by `by`, its voices taking the first one's shared fields; undefined unblends it. */
export function setBlend(c: Composition, locus: string, by: Expr | undefined): Composition {
  const blends = { ...c.blends };
  if (by === undefined) delete blends[locus];
  else blends[locus] = by;
  const lead = c.voices.find((v) => v.locus === locus);
  return syncBlend({ ...c, blends }, lead?.id ?? '');
}

/**
 * `c` with voice `next` in place of the one it edits. A blend it is in follows the edit; one it
 * has just joined gives it the fields its voices already share.
 */
export function withVoice(c: Composition, next: Voice): Composition {
  const was = c.voices.find((v) => v.id === next.id);
  const placed = { ...c, voices: c.voices.map((v) => (v.id === next.id ? next : v)) };
  const joined = was?.locus !== next.locus;
  const lead = joined
    ? placed.voices.find((v) => v.locus === next.locus && v.id !== next.id)
    : next;
  return syncBlend(placed, (lead ?? next).id);
}
