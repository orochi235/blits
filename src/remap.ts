import { passesOf, phaseOf } from './clock.js';
import { type Curve, curve } from './easing.js';
import type { Remap } from './types.js';

/** A `Remap` checked and filled in: its window's ends, a pass's length, and its curve, null for straight. */
export interface Remapped {
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly curve: Curve | null;
}

/** How many points of an owner's curve `remapFor` reads to see that it never turns back. */
const LOOKS = 512;

/**
 * A voice's remap checked against its patch's `duration`: its window defaults to the whole pass. An
 * owner's needs a window and a length above 0, and runs its children forward, since a child's start
 * and end are found by reading it backward.
 */
export function remapFor(remap: Remap, duration: number, owner: boolean): Remapped {
  const window = remap.window;
  if (window === undefined && (owner || !(duration > 0)))
    throw new Error(
      owner
        ? "blits: an owner's remap needs a window, the stretch of its children's clock it plays"
        : "blits: a remap of a patch with no duration needs a window, the stretch of the patch's time it plays",
    );
  const [from, to] = window ?? [0, duration];
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new RangeError(`blits: a remap's window is two finite times in ms, not [${from}, ${to}]`);
  const length = remap.length ?? Math.abs(to - from);
  if (!(length >= 0 && length < Number.POSITIVE_INFINITY))
    throw new RangeError(
      `blits: a remap's length is a finite number of ms, 0 or more, not ${length}`,
    );
  const ease = remap.curve === undefined || remap.curve === 'linear' ? null : curve(remap.curve);
  if (owner) forward(from, to, length, ease);
  return { from, to, length, curve: ease };
}

/** Refuses an owner's remap that turns its children's clock back, or never moves it. */
function forward(from: number, to: number, length: number, ease: Curve | null): void {
  let ok = to > from && length > 0;
  if (ok && ease !== null) {
    let last = ease(0);
    ok = Math.abs(last) < 1e-9 && Math.abs(ease(1) - 1) < 1e-9;
    for (let i = 1; ok && i <= LOOKS; i++) {
      const at = ease(i / LOOKS);
      ok = at >= last - 1e-12;
      last = at;
    }
  }
  if (!ok)
    throw new RangeError(
      "blits: an owner's remap runs its children forward: a window from a lower time to a higher, a length above 0, and a curve from 0 to 1 that may stand still but never turns back; an owner runs back by its rate",
    );
}

/** The source time a remap reads `u` of the way through a pass. */
export function sourceOf(r: Remapped, u: number): number {
  return r.from + (r.curve === null ? u : r.curve(u)) * (r.to - r.from);
}

/** A patch's phase at source time `s`, held to its one pass: 0 for a patch with no duration. */
export function sourcePhase(s: number, duration: number): number {
  if (!(duration > 0)) return 0;
  const u = s / duration;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** How fast an owner's children's clock runs against its own: the window's average speed. */
function slope(r: Remapped): number {
  return (r.to - r.from) / r.length;
}

/**
 * What an owner's children read when its own clock reads `t`: along the curve within the window,
 * and on at its average speed before it starts and after it ends.
 */
export function childTime(r: Remapped, t: number): number {
  if (t <= 0) return t === 0 ? r.from : r.from + t * slope(r);
  if (t >= r.length) return r.to + (t - r.length) * slope(r);
  return sourceOf(r, t / r.length);
}

/**
 * The time an owner's own clock first reads where its children read `s`, inverting `childTime`. A
 * curve that stands still answers where it reached `s`.
 */
export function ownTime(r: Remapped, s: number): number {
  if (!(s > r.from)) return s === r.from ? 0 : (s - r.from) / slope(r);
  if (!(s < r.to)) return s === r.to ? r.length : r.length + (s - r.to) / slope(r);
  const c = r.curve;
  const want = (s - r.from) / (r.to - r.from);
  if (c === null) return want * r.length;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (c(mid) < want) lo = mid;
    else hi = mid;
  }
  return hi * r.length;
}

/** How many ms an owner's children's clock runs in one ms of its own, at its own time `t`. */
export function childSpeed(r: Remapped, t: number): number {
  const c = r.curve;
  if (c === null || !(t > 0 && t < r.length)) return slope(r);
  const u = t / r.length;
  const h = Math.min(1e-4, u, 1 - u);
  if (!(h > 0)) return slope(r);
  return ((c(u + h) - c(u - h)) / (2 * h)) * slope(r);
}

/**
 * The source time a voice cued with `remap` plays at `elapsed` ms on its own clock, as the mix reads
 * it: `elapsed` placed in a pass of the remap's length, run through its curve and laid along its
 * window. `duration` is the patch's, and `loop` the voice's. A host that keeps its own clock, such as
 * a timeline evaluated at a playhead, reads a remapped stretch of it with this.
 *
 * @category voice
 */
export function sourceAt(
  remap: Remap,
  elapsed: number,
  duration: number,
  loop: boolean | number = false,
): number {
  const r = remapFor(remap, duration, false);
  return sourceOf(r, phaseOf(elapsed, r.length, passesOf(loop)));
}

/**
 * How long one pass of a voice cued with `remap` lasts on its own clock, ms, for a patch of
 * `duration`: its `length`, or its window's width.
 *
 * @category voice
 */
export function remapLength(remap: Remap, duration: number): number {
  return remapFor(remap, duration, false).length;
}

/** Whether a voice's clock, or an owner's above it, runs through a remap. */
export function remapped(voice: {
  readonly remap: Remapped | null;
  readonly owner: { readonly remap: Remapped | null; readonly owner: unknown } | null;
}): boolean {
  for (let v: typeof voice | null = voice; v !== null; v = v.owner as typeof voice | null)
    if (v.remap !== null) return true;
  return false;
}

/** What the children of `owner` read where its own clock reads `t`. */
export function childTimeFor(owner: { readonly remap: Remapped | null }, t: number): number {
  return owner.remap === null ? t : childTime(owner.remap, t);
}

/** Where the own clock of `owner` first reads what its children read as `s`. */
export function ownTimeFor(owner: { readonly remap: Remapped | null }, s: number): number {
  return owner.remap === null ? s : ownTime(owner.remap, s);
}
