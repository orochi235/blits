import { type Handle, keys, kit, type Mix, mix, mul, sum } from '@msb235/blits';
import { rng } from '@stress/rng';
import { createHistory as tape } from '@weasel-js/history';

export interface Pose {
  x: number;
  opacity: number;
}
export interface Elem {
  i: number;
}

export const FRAME_MS = 1000 / 60;
export const SLIDES = 40;
export const SLIDE_MS = 4000;
export const HISTORY_MS = 600_000;
const MIN_BUILDS = 2;
const MAX_BUILDS = 6;

const BUILD = kit<Pose>({ x: sum(), opacity: mul() });

export interface Build {
  slide: number;
  build: number;
  /** Its element's index, which is also its place in `deck.handles`. */
  i: number;
  ms: number;
  /** Mix time its `start` mark falls at, from `marks`. */
  start: number;
}

export interface Deck {
  m: Mix<Elem, Pose>;
  builds: Build[];
  elems: Elem[];
  handles: Handle<Elem>[];
  /** Whether `marks` knew every build's start; false means `start` was computed instead. */
  marked: boolean;
  x: Float64Array;
  opacity: Float64Array;
}

/** Plays its entrance in `ms`, then holds the finished pose until `rest` ms in, where the voice ends. */
function patch(seed: number, i: number, ms: number, rest: number) {
  const r = rng(seed * 7919 + i);
  const x1 = 40 + r.next() * 200;
  const built = ms / rest;
  return keys<Elem, Pose>(
    rest,
    [
      { at: 0, delta: { x: 0, opacity: 0 } },
      { at: built, delta: { x: x1, opacity: 1 }, ease: 'ease-in-out' },
      { at: 1, delta: { x: x1, opacity: 1 } },
    ],
    {},
  );
}

/**
 * Slides are owners laid end to end on the mix clock. A slide's builds each start where the one
 * before has built, by anchor rather than a span's queue, and hold their finished pose until the
 * slide's length is up, where they all end together and their `done` resolves.
 */
export function build(seed: number, size: number, lanes: boolean | undefined): Deck {
  const slides = Math.max(2, Math.round(size * SLIDES));
  const m = mix<Elem, Pose>(BUILD, { name: 'deck', lanes, history: { ms: HISTORY_MS, tape } });
  const builds: Build[] = [];
  const elems: Elem[] = [];
  const handles: Handle<Elem>[] = [];
  for (let s = 0; s < slides; s++) {
    const r = rng(seed * 104729 + s);
    const count = MIN_BUILDS + r.int(MAX_BUILDS - MIN_BUILDS + 1);
    const slide = m.owns({ name: `slide${s}`, start: s * SLIDE_MS });
    let at = s * SLIDE_MS;
    for (let k = 0; k < count; k++) {
      const i = elems.length;
      const offset = at - s * SLIDE_MS;
      const ms = 300 + r.int(300);
      const elem: Elem = { i };
      elems.push(elem);
      builds.push({ slide: s, build: k, i, ms, start: at });
      handles.push(
        m.cue({
          owner: slide,
          patch: patch(seed, i, ms, SLIDE_MS - offset),
          subjects: [elem],
          loop: false,
          marks: { built: ms },
          name: `s${s}b${k}`,
          ...(k === 0
            ? { start: 0 }
            : { anchor: { start: { of: `s${s}b${k - 1}`, mark: 'built' } } }),
        }),
      );
      at += ms;
    }
  }
  m.sync(0);
  const marked = markStarts(m, builds, slides);
  return {
    m,
    builds,
    elems,
    handles,
    marked,
    x: new Float64Array(elems.length),
    opacity: new Float64Array(elems.length),
  };
}

/** Takes each build's start from the score's marks, as a presenter's NEXT would. */
function markStarts(m: Mix<Elem, Pose>, builds: Build[], slides: number): boolean {
  const byName = new Map<string, number>();
  for (const k of m.marks(0, slides * SLIDE_MS + 1)) {
    if (k.mark === 'start' && k.name) byName.set(k.name, k.timestamp);
  }
  let all = true;
  for (const b of builds) {
    const t = byName.get(`s${b.slide}b${b.build}`);
    if (t === undefined) all = false;
    else b.start = t;
  }
  return all;
}

/** Writes every element's pose into `out`: all `x`, then all `opacity`. */
export function readInto(d: Deck, out: Float64Array): void {
  d.m.pull(d.elems, { x: d.x, opacity: d.opacity });
  out.set(d.x, 0);
  out.set(d.opacity, d.elems.length);
}

/** Names the build and channel a position in `readInto`'s output belongs to. */
export function where(d: Deck, k: number): string {
  const n = d.elems.length;
  const b = d.builds[k % n] as Build;
  return `slide ${b.slide} build ${b.build} ${k < n ? 'x' : 'opacity'}`;
}
