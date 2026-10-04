import type { Clip } from '@pg/widgets/ScoreLanes';
import { dragEdit } from '@pg/widgets/ScoreLanes/drag';
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
});
