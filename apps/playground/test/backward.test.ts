import { keys, mix } from '@msb235/blits';
import { playOf } from '@pg/blits/clip';
import { compile } from '@pg/blits/compile';
import type { Composition, Group, PatchSource, Voice } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import { KIT, type Mixed } from '@pg/blits/kit';
import { load } from '@pg/blits/load';
import { placedOf } from '@pg/blits/placed';
import { applyEdit, clipsOf } from '@pg/blits/score';
import type { Subject } from '@pg/blits/stage';
import { passLines } from '@pg/widgets/ScoreLanes/geometry';
import { tickTimes } from '@pg/widgets/ScoreLanes/Marks';
import { describe, expect, it } from 'vitest';
import { comp, group, same, subjects, voice } from './helpers';

const stops = [
  { at: 0, delta: { scale: 1 } },
  { at: 1, delta: { scale: 2 } },
];
const KEYS: PatchSource = { kind: 'keys', period: 400, stops };
const twice = (over: Partial<Voice> = {}) => voice({ id: 'a', patch: KEYS, loop: 2, ...over });
const hand = () => mix<Subject, Mixed>(KIT, { stepMs: FRAME });

describe('a voice cued partway or backward', () => {
  it.each([
    ['a seek', { seek: 300 }],
    ['a rate below 0', { rate: -1 }],
    ['both', { rate: -2, seek: 500, freeze: 'before' as const }],
  ])('gives the poses of the hand-written cue with %s', (_, over) => {
    const built = compile(comp([twice({ start: 100, ...over })]), subjects);
    expect(built.errors).toEqual([]);
    const m = hand();
    m.cue({ patch: keys(400, stops), loop: 2, start: 100, ...over });
    same(built.mix, m);
  });

  it('draws what is left to play, where blits ends it', () => {
    const cases: [Partial<Voice>, number][] = [
      [{ seek: 300 }, 500],
      [{ rate: -1 }, 800],
      [{ rate: -2, seek: 500 }, 250],
      [{ rate: 2, seek: 100 }, 350],
    ];
    for (const [over, length] of cases) {
      const c = comp([twice({ start: 100, ...over })]);
      const built = compile(c, subjects);
      const [clip] = clipsOf(c, subjects, { built }).clips;
      if (!clip) throw new Error('no clip');
      expect(clip.pass * clip.passes).toBeCloseTo(length, 9);
      expect(placedOf(built).get('a')?.coast).toBeCloseTo(100 + length, 9);
    }
  });

  it('puts the pass dividers and hit ticks where the passes turn', () => {
    expect(playOf(400, 1, 2, 300)).toEqual({ pass: 400, passes: 1.25, into: 300 });
    expect(playOf(400, -1, 2)).toEqual({ pass: 400, passes: 2 });
    expect(playOf(400, -2, 2, 500)).toEqual({ pass: 200, passes: 1.25, into: 150 });
    expect(playOf(400, -1, Number.POSITIVE_INFINITY).passes).toBe(Number.POSITIVE_INFINITY);
    expect(playOf(400, 0, 2).pass).toBe(0);
    const c = comp([twice({ seek: 300, hits: [{ at: 50, event: 'x' }] })]);
    const [clip] = clipsOf(c, subjects).clips;
    if (!clip) throw new Error('no clip');
    expect(passLines(clip, 2000)).toEqual([100]);
    expect(tickTimes(clip, 2000)).toEqual([150]);
    const back = clipsOf(comp([twice({ rate: -1, hits: [{ at: 50, event: 'x' }] })]), subjects);
    expect(back.clips[0]?.label).toBe('a · keys · backward');
    expect(back.clips[0]?.ticks).toBeUndefined();
  });

  it('sets loop by its right edge, to the loop that leaves what the clip shows', () => {
    const c = comp([twice({ seek: 300 })]);
    expect(applyEdit(c, { clip: 'a', kind: 'passes', passes: 1 })).toBe(c);
    const longer = applyEdit(c, { clip: 'a', kind: 'passes', passes: 2.25 });
    expect(longer.voices[0]?.loop).toBe(3);
    const built = compile(longer, subjects);
    const [clip] = clipsOf(longer, subjects, { built }).clips;
    expect(placedOf(built).get('a')?.coast).toBeCloseTo(clip ? clip.pass * clip.passes : 0, 9);
  });

  it('loads a seek, and refuses one that is no number', () => {
    const c = comp([twice({ seek: 300, rate: -1 })]);
    expect(load(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(load(comp([twice({ seek: 'end' as never })]))).toBeNull();
  });

  it("loads a voice's own stepMs, and refuses one below 0", () => {
    const c = comp([twice({ stepMs: 8 })]);
    expect(load(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(load(comp([twice({ stepMs: -1 })]))).toBeNull();
  });
});

describe('a group cued partway or backward', () => {
  const under = (g: Partial<Group>) =>
    comp(
      [voice({ id: 'a', patch: KEYS, loop: false, start: 100, owner: 'g' })],
      [group({ id: 'g', start: 50, ...g })],
    );
  const drawn = (c: Composition) => clipsOf(c, subjects, { built: compile(c, subjects) });

  it('draws a member under a group run back from where it comes back to its end', () => {
    const [clip] = drawn(under({ rate: -1, seek: 700 })).clips;
    expect(clip).toMatchObject({ start: 250, pass: 400, passes: 1, label: 'a · keys · backward' });
    expect(clip?.skipped).toBeUndefined();
    // A seek partway into the member draws only what is left, from the group's start.
    const [part] = drawn(under({ rate: -1, seek: 300 })).clips;
    expect(part).toMatchObject({ start: 50, pass: 400, passes: 0.5 });
  });

  it("notches a group's hits on its header, from its seek to its end, and none running back", () => {
    const hits = [
      { at: 50, event: 'behind' },
      { at: 300, event: 'b' },
      { at: 2000, event: 'past' },
    ];
    const [header] = drawn(under({ rate: 2, seek: 100, hits })).headers;
    expect(header).toMatchObject({ start: 50, end: 250, ticks: [150] });
    const [back] = drawn(under({ rate: -1, seek: 700, hits })).headers;
    expect(back?.ticks).toBeUndefined();
    expect(back?.label).toBe('g · owner · backward');
  });

  it("loads a group's seek, tags, score, and hits, and refuses a bad hit", () => {
    const c = under({ seek: 100, tags: ['band'], score: 's', hits: [{ at: 0, event: 'e' }] });
    expect(load(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(load(under({ hits: [{ at: -1, event: 'e' }] }))).toBeNull();
    expect(load(under({ seek: 'end' as never }))).toBeNull();
  });
});
