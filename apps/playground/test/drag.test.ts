import type { Clip } from '@pg/widgets/ScoreLanes';
import { dragEdit, groupDrop, hatchOf } from '@pg/widgets/ScoreLanes/drag';
import { MAX_PASSES } from '@pg/widgets/ScoreLanes/geometry';
import { describe, expect, it } from 'vitest';

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a',
  lane: 0,
  label: 'a',
  hue: 200,
  start: 100,
  pass: 500,
  passes: 2,
  fadeIn: 50,
  fadeOut: 50,
  spread: 0,
  holdBefore: false,
  holdAfter: false,
  ...c,
});

describe('dragEdit', () => {
  it('moves the body, not before 0', () => {
    expect(dragEdit(clip({}), 'body', 40)).toEqual({ clip: 'a', kind: 'move', start: 140 });
    expect(dragEdit(clip({}), 'body', -500)).toEqual({ clip: 'a', kind: 'move', start: 0 });
  });
  it('does not move an anchored clip', () => {
    expect(dragEdit(clip({ locked: true }), 'body', 40)).toBeNull();
  });
  it('snaps the end to whole passes, at least one', () => {
    expect(dragEdit(clip({}), 'end', 300)).toEqual({ clip: 'a', kind: 'passes', passes: 3 });
    expect(dragEdit(clip({}), 'end', -2000)).toEqual({ clip: 'a', kind: 'passes', passes: 1 });
  });
  it("leaves an aperiodic clip's end alone", () => {
    expect(dragEdit(clip({ pass: 0, passes: 1 }), 'end', 300)).toBeNull();
    expect(dragEdit(clip({ pass: 0, passes: Number.POSITIVE_INFINITY }), 'end', -300)).toBeNull();
  });
  it('makes an open clip finite from its arrow', () => {
    expect(dragEdit(clip({ passes: Number.POSITIVE_INFINITY }), 'end', 0)).toEqual({
      clip: 'a',
      kind: 'passes',
      passes: 1,
    });
  });
  it('clamps fades to 0..clip length', () => {
    expect(dragEdit(clip({}), 'fadeIn', 30)).toEqual({ clip: 'a', kind: 'fadeIn', ms: 80 });
    expect(dragEdit(clip({}), 'fadeOut', -30)).toEqual({ clip: 'a', kind: 'fadeOut', ms: 80 });
    expect(dragEdit(clip({}), 'fadeIn', -100)).toEqual({ clip: 'a', kind: 'fadeIn', ms: 0 });
  });
  it('keeps fade in plus fade out within the clip', () => {
    expect(dragEdit(clip({}), 'fadeIn', 5000)).toEqual({ clip: 'a', kind: 'fadeIn', ms: 950 });
    expect(dragEdit(clip({ fadeIn: 700 }), 'fadeOut', -5000)).toEqual({
      clip: 'a',
      kind: 'fadeOut',
      ms: 300,
    });
  });
  it('caps passes at MAX_PASSES', () => {
    expect(dragEdit(clip({}), 'end', 1e9)).toEqual({
      clip: 'a',
      kind: 'passes',
      passes: MAX_PASSES,
    });
  });
});

describe('hatchOf', () => {
  it('reads the two holds as one choice', () => {
    expect(hatchOf(clip({}))).toBeNull();
    expect(hatchOf(clip({ holdBefore: true }))).toBe('before');
    expect(hatchOf(clip({ holdAfter: true }))).toBe('after');
    expect(hatchOf(clip({ holdBefore: true, holdAfter: true }))).toBe('both');
  });
});

describe('groupDrop', () => {
  const clips = [
    clip({ id: 'a', lane: 0 }),
    clip({ id: 'b', lane: 1 }),
    clip({ id: 'c', lane: 2, group: 'g' }),
    clip({ id: 'd', lane: 3, group: 'g' }),
  ];
  it("groups with the lane's clip", () => {
    expect(groupDrop(clips, 'a', 1)).toEqual({ clip: 'a', kind: 'group', with: 'b' });
  });
  it('ignores its own lane, an empty lane and its own group', () => {
    expect(groupDrop(clips, 'a', 0)).toBeNull();
    expect(groupDrop(clips, 'a', 9)).toBeNull();
    expect(groupDrop(clips, 'c', 3)).toBeNull();
  });
});
