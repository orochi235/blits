import type { Clip, Header } from '@pg/widgets/ScoreLanes';
import {
  blockEnd,
  clipEnd,
  clipPolygon,
  factorText,
  groupBrackets,
  laneCount,
  passLines,
  scaleOf,
  shownEnd,
  slopePolygon,
} from '@pg/widgets/ScoreLanes/geometry';
import { describe, expect, it } from 'vitest';

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a',
  lane: 0,
  label: 'a',
  hue: 200,
  start: 0,
  pass: 500,
  passes: 2,
  fadeIn: 0,
  fadeOut: 0,
  spread: 0,
  freezeBefore: false,
  freezeAfter: false,
  ...c,
});

const header = (h: Partial<Header>): Header => ({
  id: 'h',
  lane: 0,
  depth: 0,
  label: 'h',
  hue: 40,
  start: 0,
  end: 1000,
  ...h,
});

describe('geometry', () => {
  it('maps time to x past the label column and back', () => {
    const s = scaleOf(2000, 1140, 140);
    expect(s.x(0)).toBe(140);
    expect(s.x(2000)).toBe(1140);
    expect(s.t(640)).toBe(1000);
  });
  it('stays finite over an empty duration', () => {
    const s = scaleOf(0, 1000, 0);
    expect(Number.isFinite(s.x(0))).toBe(true);
    expect(Number.isFinite(s.t(500))).toBe(true);
  });
  it('ends a clip after its passes, or never', () => {
    expect(clipEnd(clip({ start: 100 }))).toBe(1100);
    expect(clipEnd(clip({ passes: Number.POSITIVE_INFINITY }))).toBe(Number.POSITIVE_INFINITY);
  });
  it('slopes the fades', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ fadeIn: 100, fadeOut: 200 }), s, 10, 20, 1000)).toBe(
      '0,30 100,10 800,10 1000,30',
    );
  });
  it('draws an open clip to the view end', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ passes: Number.POSITIVE_INFINITY }), s, 0, 10, 1000)).toBe(
      '0,10 0,0 1000,0 1000,10',
    );
  });
  it('puts dividers between passes, none for an aperiodic clip', () => {
    expect(passLines(clip({ passes: 3 }), 5000)).toEqual([500, 1000]);
    expect(passLines(clip({ pass: 0, passes: 1 }), 5000)).toEqual([]);
  });
  it('brackets groups of two or more, hued by their first clip', () => {
    const clips = [
      clip({ id: 'a', lane: 0, group: 'g', hue: 10 }),
      clip({ id: 'b', lane: 1 }),
      clip({ id: 'c', lane: 3, group: 'g', hue: 99 }),
      clip({ id: 'd', lane: 2, group: 'solo' }),
    ];
    expect(groupBrackets(clips)).toEqual([{ group: 'g', hue: 10, from: 0, to: 3, depth: 0 }]);
  });
  it('shares a column between brackets whose lanes do not overlap', () => {
    const lanes: [number, string][] = [
      [0, 'x'],
      [2, 'x'],
      [1, 'y'],
      [3, 'y'],
      [4, 'z'],
      [5, 'z'],
    ];
    const clips = lanes.map(([lane, group]) => clip({ id: `${lane}`, lane, group }));
    expect(groupBrackets(clips).map((b) => [b.group, b.depth])).toEqual([
      ['x', 0],
      ['y', 1],
      ['z', 0],
    ]);
  });
  it('counts lanes over clips and headers', () => {
    expect(laneCount([], [])).toBe(1);
    expect(laneCount([clip({ lane: 1 })], [header({ lane: 3 })])).toBe(4);
  });
  it('ends a header’s block at the next row no deeper than it', () => {
    const outer = header({ id: 'o', lane: 0, depth: 0 });
    const inner = header({ id: 'i', lane: 1, depth: 1 });
    const clips = [
      clip({ id: 'a', lane: 2, depth: 2 }),
      clip({ id: 'b', lane: 3, depth: 1 }),
      clip({ id: 'c', lane: 4 }),
    ];
    expect(blockEnd(outer, clips, [outer, inner])).toBe(3);
    expect(blockEnd(inner, clips, [outer, inner])).toBe(2);
    expect(blockEnd(header({ lane: 5 }), clips, [])).toBe(5);
  });
  it('shows a factor other than 1 to two places at most', () => {
    expect(factorText(1)).toBe('');
    expect(factorText(undefined)).toBe('');
    expect(factorText(1.3)).toBe('×1.3');
    expect(factorText(2)).toBe('×2');
    expect(factorText(1 / 3)).toBe('×0.33');
  });
});

describe('a clip cut short by its group', () => {
  const s = scaleOf(1000, 1000, 0);
  const open = clip({ passes: Number.POSITIVE_INFINITY, fadeOut: 100 });
  it('ends at the cut when it would run past it', () => {
    expect(shownEnd(clip({ cut: { at: 800, fade: 0 } }))).toBe(800);
    expect(shownEnd(clip({ cut: { at: 1500, fade: 0 } }))).toBe(1000);
    expect(shownEnd(open)).toBe(Number.POSITIVE_INFINITY);
  });
  it('slopes out over the group’s fade, ending at the cut', () => {
    expect(clipPolygon({ ...open, cut: { at: 800, fade: 200 } }, s, 0, 10, 1000)).toBe(
      '0,10 0,0 600,0 800,10',
    );
  });
  it('keeps its own fade out where that starts sooner', () => {
    const own = clip({ passes: 2, fadeOut: 400, cut: { at: 900, fade: 100 } });
    expect(clipPolygon(own, s, 0, 10, 1000)).toBe('0,10 0,0 600,0 900,10');
  });
  it('ignores a cut it ends before', () => {
    const early = clip({ passes: 1, fadeOut: 100, cut: { at: 800, fade: 300 } });
    expect(clipPolygon(early, s, 0, 10, 1000)).toBe('0,10 0,0 400,0 500,10');
  });
});

describe('slopePolygon', () => {
  const s = scaleOf(1000, 1000, 0);
  it('slopes both ends of an extent', () => {
    expect(slopePolygon({ start: 100, end: 900, fadeIn: 200, fadeOut: 100 }, s, 0, 8, 1000)).toBe(
      '100,8 300,0 800,0 900,8',
    );
  });
  it('runs an endless extent flat to the view end', () => {
    const e = { start: 0, end: Number.POSITIVE_INFINITY, fadeIn: 0, fadeOut: 300 };
    expect(slopePolygon(e, s, 0, 8, 600)).toBe('0,8 0,0 600,0 600,8');
  });
});
