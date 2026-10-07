import { clampWeight, elapsedWith, envelope, timeWith } from './clock.js';
import type { Patch } from './types.js';
import type { Voice } from './voice.js';

/** What an owner is cued with in place of a patch: it writes nothing, so no fold ever meets it. */
export const ownerPatch: Patch<unknown, unknown, unknown> = Object.freeze({
  form: 'fn',
  duration: 0,
  writes: [],
  at: () => ({}),
});

/** What an owner keeps of the voices it holds. */
export class Holding<V> {
  /** Its children still in the mix, in cue order. */
  children: V[] = [];
  /** How many it has held, and how many of those finished their passes. */
  kids = 0;
  played = 0;
}

/**
 * What an owner's clock reads at mix time `now`, through every owner above it: -Infinity before it
 * starts, where its children show nothing.
 */
export function ownerReading<I, O>(owner: Voice<I, O>, now: number): number {
  const t = owner.owner === null ? now : ownerReading(owner.owner, now);
  return t >= owner.start ? elapsedWith(owner, t) : Number.NEGATIVE_INFINITY;
}

/** What a voice an owner holds reads at mix time `now`: -Infinity before the owner starts. */
export function ownedElapsed<I, O>(voice: Voice<I, O>, owner: Voice<I, O>, now: number): number {
  const t = ownerReading(owner, now);
  return t === Number.NEGATIVE_INFINITY ? t : elapsedWith(voice, t);
}

/** The mix time an owner's clock reads `t`, by its controls now; Infinity where it never will. */
export function mixTime<I, O>(owner: Voice<I, O>, t: number): number {
  const up = timeWith(owner, t);
  return owner.owner === null ? up : mixTime(owner.owner, up);
}

/** Takes a child into its owner. */
export function adopt<I, O>(owner: Voice<I, O>, child: Voice<I, O>): void {
  const h = owner.holding as Holding<Voice<I, O>>;
  h.children.push(child);
  h.kids++;
}

/** A child left: its owner, where that was its last child and it should leave too. */
export function orphan<I, O>(child: Voice<I, O>): Voice<I, O> | null {
  const owner = child.owner as Voice<I, O>;
  const h = owner.holding as Holding<Voice<I, O>>;
  const i = h.children.indexOf(child);
  if (i >= 0) h.children.splice(i, 1);
  return h.children.length === 0 && owner.state !== 'done' ? owner : null;
}

/** A child finished its passes: its owner has played once every child it held has. */
export function childPlayed<I, O>(owner: Voice<I, O>, at: number): void {
  const h = owner.holding as Holding<Voice<I, O>>;
  if (++h.played === h.kids) owner.play(true, at);
}

/** Every voice an owner holds, its children's children included. */
export function descendants<I, O>(owner: Voice<I, O>, visit: (v: Voice<I, O>) => void): void {
  for (const child of (owner.holding as Holding<Voice<I, O>>).children) {
    visit(child);
    if (child.holding !== null) descendants(child, visit);
  }
}

/** Whether any owner above a voice reads a signal for its weight, which lanes cannot fill. */
export function signalled<I, O>(voice: Voice<I, O>): boolean {
  for (let o = voice.owner; o !== null; o = o.owner)
    if (typeof o.spec.weight === 'function') return true;
  return false;
}

/** Whether any owner above a voice weighs it by input from outside the clock. */
export function heldByInput<I, O>(voice: Voice<I, O>): boolean {
  for (let o = voice.owner; o !== null; o = o.owner) {
    const w = o.spec.weight;
    if (typeof w === 'function' && w.input) return true;
  }
  return false;
}

/**
 * What one owner multiplies into its children's weight for a subject at mix time `now`: its weight,
 * or its signal's read by `base`, times its own fade, held to 0..1. Its fade in counts from when it
 * started, or from when it first showed where it freezes before.
 */
export function ownWeight<I, O>(
  owner: Voice<I, O>,
  now: number,
  reduced: boolean,
  base: (owner: Voice<I, O>) => number,
): number {
  const b = typeof owner.spec.weight === 'function' ? base(owner) : owner.weight;
  const start = owner.owner === null ? owner.start : mixTime(owner.owner, owner.start);
  const since = owner.freezesBefore && owner.opened < start ? owner.opened : start;
  return clampWeight(
    b * envelope(owner.fade.in ?? 0, owner.out, owner.ease, reduced, now, since, owner.back),
  );
}

/** What every owner above a voice multiplies into its weight. */
export function ownersWeight<I, O>(
  voice: Voice<I, O>,
  now: number,
  reduced: boolean,
  base: (owner: Voice<I, O>) => number,
): number {
  let w = 1;
  for (let o = voice.owner; o !== null; o = o.owner) w *= ownWeight(o, now, reduced, base);
  return w;
}

/** Points a projection's copies at each other's owners, each owner holding only copies. */
export function relink<I, O>(copies: readonly Voice<I, O>[]): void {
  const byId = new Map<number, Voice<I, O>>();
  for (const v of copies) {
    byId.set(v.id, v);
    if (v.holding !== null) {
      const h = new Holding<Voice<I, O>>();
      h.kids = v.holding.kids;
      h.played = v.holding.played;
      v.holding = h;
    }
  }
  for (const v of copies) {
    const o = v.owner === null ? undefined : byId.get(v.owner.id);
    if (o === undefined) continue;
    v.owner = o;
    (o.holding as Holding<Voice<I, O>>).children.push(v);
  }
}
