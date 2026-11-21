import type { Clip, Header } from './index';

/** The score's width in its own units; the svg scales to fit. */
export const WIDTH = 1000;
/** The ruler's height above the lanes. */
export const RULER = 24;
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

/** The score time under `x`, held to the score. */
export const timeAt = (s: Scale, x: number, duration: number): number =>
  Math.min(duration, Math.max(0, s.t(x)));

/** Least room, in score units, between two of the ruler's labels. */
export const TICK_ROOM = 36;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** The ruler's labeled times, ms: whole seconds, as many as fit `span` units without overprinting. */
export function rulerTicks(duration: number, span: number): number[] {
  const perSecond = (span / Math.max(1, duration)) * 1000;
  const step =
    (TICK_STEPS.find((n) => n * perSecond >= TICK_ROOM) ??
      Math.ceil(TICK_ROOM / perSecond / 3600) * 3600) * 1000;
  return Array.from({ length: Math.floor(Math.max(0, duration) / step) + 1 }, (_, i) => i * step);
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

/** A bar over `e` with its fades as slopes; an end past `viewEnd` is cut there at the height the
 *  bar has reached, so an open end runs flat to it. */
export function slopePolygon(e: Extent, s: Scale, top: number, h: number, viewEnd: number): string {
  const end = Math.min(e.end, viewEnd);
  const outAt = Math.min(e.end - e.fadeOut, end);
  const left = e.end > end ? Math.min(1, e.fadeOut > 0 ? (e.end - end) / e.fadeOut : 1) : 0;
  const fmt = (x: number, y: number) => `${Math.round(x * 100) / 100},${y}`;
  const points = [
    fmt(s.x(e.start), top + h),
    fmt(s.x(e.start + e.fadeIn), top),
    fmt(s.x(outAt), top),
    fmt(s.x(end), top + h * (1 - left)),
    fmt(s.x(end), top + h),
  ];
  return points.filter((x, i) => x !== points[i - 1]).join(' ');
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
  for (
    let t = c.start + c.pass - (c.into ?? 0);
    t < end - 1e-9 && out.length < MAX_PASSES;
    t += c.pass
  )
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
