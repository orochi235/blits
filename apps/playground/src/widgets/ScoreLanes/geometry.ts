import type { Clip, Header } from './index';

/** The score's width in its own units; the svg scales to fit. */
export const WIDTH = 1000;
/** How far a label indents per depth. */
export const INDENT = 12;

/** Most passes a clip shows dividers for, and most its end handle snaps to. */
export const MAX_PASSES = 200;

export interface Scale {
  x(t: number): number;
  t(x: number): number;
}

export function scaleOf(duration: number, width: number, labelWidth: number): Scale {
  const span = Math.max(1, width - labelWidth);
  const d = duration > 0 ? duration : 1;
  return {
    x: (t) => labelWidth + (t / d) * span,
    t: (x) => ((x - labelWidth) / span) * d,
  };
}

export function clipEnd(c: Clip): number {
  if (!Number.isFinite(c.passes)) return Number.POSITIVE_INFINITY;
  return c.start + (c.pass > 0 ? c.pass * c.passes : 0);
}

/** Where the clip's group cuts it, when that comes before its own end. */
export const cutOf = (c: Clip): Clip['cut'] => (c.cut && c.cut.at < clipEnd(c) ? c.cut : undefined);

/** Where the clip is drawn to: its own end, or its group's cut. */
export const shownEnd = (c: Clip): number => cutOf(c)?.at ?? clipEnd(c);

export interface Extent {
  start: number;
  end: number; // Infinity = open-ended
  fadeIn: number;
  fadeOut: number;
}

/** A bar over `e` with its fades as slopes; an open end runs flat to `viewEnd`. */
export function slopePolygon(e: Extent, s: Scale, top: number, h: number, viewEnd: number): string {
  const open = !Number.isFinite(e.end);
  const end = Math.min(e.end, viewEnd);
  const x0 = s.x(e.start);
  const x1 = s.x(end);
  const inX = s.x(e.start + e.fadeIn);
  const outX = open ? x1 : s.x(end - e.fadeOut);
  const fmt = (x: number, y: number) => `${Math.round(x * 100) / 100},${y}`;
  return [fmt(x0, top + h), fmt(inX, top), fmt(outX, top), fmt(x1, top + h)].join(' ');
}

export function clipPolygon(c: Clip, s: Scale, top: number, h: number, viewEnd: number): string {
  const cut = cutOf(c);
  const own = clipEnd(c) - c.fadeOut;
  const fadeOut = cut ? cut.at - Math.max(c.start, Math.min(own, cut.at - cut.fade)) : c.fadeOut;
  return slopePolygon(
    { start: c.start, end: shownEnd(c), fadeIn: c.fadeIn, fadeOut },
    s,
    top,
    h,
    viewEnd,
  );
}

export function passLines(c: Clip, viewEnd: number): number[] {
  if (c.pass <= 0) return [];
  const end = Math.min(shownEnd(c), viewEnd);
  const out: number[] = [];
  for (let t = c.start + c.pass; t < end - 1e-9 && out.length < MAX_PASSES; t += c.pass)
    out.push(t);
  return out;
}

export interface Bracket {
  group: string;
  hue: number;
  from: number; // first lane
  to: number; // last lane
  depth: number; // column, 0 nearest the lanes; brackets whose lanes don't overlap share one
}

/** One bracket per group of two or more clips, hued by its first clip, in order of first appearance. */
export function groupBrackets(clips: readonly Clip[]): Bracket[] {
  const out = new Map<string, Omit<Bracket, 'depth'> & { count: number }>();
  for (const c of clips) {
    if (c.group === undefined) continue;
    const b = out.get(c.group);
    if (!b) out.set(c.group, { group: c.group, hue: c.hue, from: c.lane, to: c.lane, count: 1 });
    else {
      b.from = Math.min(b.from, c.lane);
      b.to = Math.max(b.to, c.lane);
      b.count++;
    }
  }
  const ends: number[] = []; // last lane taken in each column
  return [...out.values()]
    .filter((b) => b.count > 1)
    .map(({ group, hue, from, to }) => {
      let depth = ends.findIndex((end) => end < from);
      if (depth < 0) depth = ends.length;
      ends[depth] = to;
      return { group, hue, from, to, depth };
    });
}

export const laneCount = (clips: readonly Clip[], headers: readonly Header[]): number =>
  Math.max(1, ...clips.map((c) => c.lane + 1), ...headers.map((h) => h.lane + 1));

/** The last lane of `h`'s block: every lane below it holding a row deeper than it. */
export function blockEnd(h: Header, clips: readonly Clip[], headers: readonly Header[]): number {
  const depths = new Map<number, number>();
  for (const c of clips) depths.set(c.lane, c.depth ?? 0);
  for (const x of headers) depths.set(x.lane, x.depth);
  let last = h.lane;
  for (let d = depths.get(last + 1); d !== undefined && d > h.depth; d = depths.get(last + 1))
    last++;
  return last;
}

export const factorText = (f: number | undefined): string =>
  f === undefined || f === 1 ? '' : `×${Math.round(f * 100) / 100}`;
