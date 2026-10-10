import { compile } from '@pg/blits/compile';
import type { Composition, Voice } from '@pg/blits/composition';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { describe, expect, it } from 'vitest';
import { comp, group, subjects, voice } from './helpers';

const once = (id: string, over: Partial<Voice> = {}) =>
  voice({
    id,
    patch: { kind: 'keys', period: 400, stops: [{ at: 0, delta: { glow: 1 } }] },
    loop: false,
    ...over,
  });
const drawn = (c: Composition) => {
  const built = compile(c, subjects);
  return {
    built,
    clip: (id: string) => clipsOf(c, subjects, { built }).clips.find((x) => x.id === id),
  };
};

describe('clips placed from a build', () => {
  const owned = comp(
    [
      once('a', { owner: 'o', start: 1500 }),
      once('b', { owner: 'o', anchor: { start: { after: 'a' } } }),
      once('x', { start: 100 }),
      once('y', { anchor: { start: { after: 'x' } } }),
    ],
    [group({ id: 'o', start: 300, rate: 2 })],
  );
  const { built, clip } = drawn(owned);

  it('draws a voice under an owner on the owner’s clock', () => {
    expect(clip('a')).toMatchObject({ start: 300 + 1500 / 2, pass: 200, locked: false });
    const still = comp([once('a', { owner: 'o', start: 1500 })], [group({ id: 'o', start: 300 })]);
    expect(drawn(still).clip('a')?.start).toBe(1800);
  });
  it('draws an anchored voice where its anchor put it, locked', () => {
    expect(clip('b')).toMatchObject({ start: 1050 + 200, locked: true });
    expect(clip('y')).toMatchObject({ start: 500, locked: true });
  });
  it('a move lands the clip where the pointer left it, on the owner’s clock', () => {
    const moved = applyEdit(owned, { clip: 'a', kind: 'move', start: 1150 }, built);
    expect(moved.voices[0]?.start).toBe(1700);
    expect(drawn(moved).clip('a')?.start).toBe(1150);
    const top = applyEdit(owned, { clip: 'x', kind: 'move', start: 250 }, built);
    expect(top.voices[2]?.start).toBe(250);
  });
  it('a move to where the clip already is changes nothing, and never goes below 0', () => {
    expect(applyEdit(owned, { clip: 'a', kind: 'move', start: 1050 }, built)).toBe(owned);
    const back = applyEdit(owned, { clip: 'a', kind: 'move', start: 0 }, built);
    expect(back.voices[0]?.start).toBe(0);
  });
  it('refuses a move or a start link on a span’s child', () => {
    const spanned = comp(
      [once('a', { owner: 's' }), once('z')],
      [group({ id: 's', kind: 'span', span: {} })],
    );
    const b = compile(spanned, subjects);
    expect(applyEdit(spanned, { clip: 'a', kind: 'move', start: 500 }, b)).toBe(spanned);
    const link = { from: { clip: 'a', edge: 'start' }, to: { clip: 'z', edge: 'end' } } as const;
    expect(applyEdit(spanned, { clip: 'a', kind: 'link', link })).toBe(spanned);
  });
});

describe('a group that ends', () => {
  const looped = (id: string, owner: string) =>
    voice({ id, owner, patch: { kind: 'keys', period: 800, stops: [{ at: 0, delta: {} }] } });
  const band = group({
    id: 'band',
    start: 300,
    fade: { in: 400, out: 400 },
    anchor: { end: 2800 },
  });
  const c = comp(
    [looped('a', 'band'), looped('b', 'inner')],
    [band, group({ id: 'inner', owner: 'band' })],
  );
  const score = clipsOf(c, subjects, { built: compile(c, subjects) });

  it('cuts its members at its end, with its fade out', () => {
    const cut = { at: 2800, fade: 400 };
    expect(score.clips.find((x) => x.id === 'a')?.cut).toEqual(cut);
    expect(score.clips.find((x) => x.id === 'b')?.cut).toEqual(cut);
  });
  it('gives its header its fades', () => {
    expect(score.headers[0]).toMatchObject({ end: 2800, fadeIn: 400, fadeOut: 400 });
  });
  it('cuts nothing when it never ends', () => {
    const free = comp([looped('a', 'o')], [group({ id: 'o' })]);
    const clips = clipsOf(free, subjects, { built: compile(free, subjects) }).clips;
    expect(clips[0]?.cut).toBeUndefined();
  });
});
