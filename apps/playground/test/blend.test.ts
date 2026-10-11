import { keys, mix } from '@msb235/blits';
import { setBlend, shareOf, stopOf, syncBlend, withVoice } from '@pg/blits/blend';
import { compile } from '@pg/blits/compile';
import type { Composition, PatchSource, Voice } from '@pg/blits/composition';
import { flowOf } from '@pg/blits/flow';
import { FRAME } from '@pg/blits/frame';
import { KIT, type Mixed } from '@pg/blits/kit';
import { load } from '@pg/blits/load';
import { applyEdit, clipsOf } from '@pg/blits/score';
import type { Subject } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';
import { comp, same, subjects, voice } from './helpers';

const stopsOf = (scale: number) => [
  { at: 0, delta: { scale: 1 } },
  { at: 1, delta: { scale } },
];
const patchOf = (scale: number): PatchSource => ({
  kind: 'keys',
  period: 400,
  stops: stopsOf(scale),
});
const SCALES = [2, 3, 5];
const member = (i: number, over: Partial<Voice> = {}) =>
  voice({ id: `m${i}`, patch: patchOf(SCALES[i] as number), locus: 'tone', ...over });
const BY = '(s) => s.x';
const blended = (voices: Voice[], by = BY): Composition => ({
  ...comp(voices),
  blends: { tone: { code: by } },
});
const three = (over: Partial<Voice> = {}) => blended([0, 1, 2].map((i) => member(i, over)));

describe('a blend', () => {
  it('gives the poses of the hand-written mix.blend', () => {
    const built = compile(three({ start: 100, fade: { in: 200 }, loop: 2 }), subjects);
    expect(built.errors).toEqual([]);
    const m = mix<Subject, Mixed>(KIT, { stepMs: FRAME });
    const handles = m.blend(
      SCALES.map((k) => keys(400, stopsOf(k))),
      (s) => s.x,
      { start: 100, fade: { in: 200 }, loop: 2 },
    );
    same(built.mix, m);
    expect([...built.handles.keys()]).toEqual(['m0', 'm1', 'm2']);
    expect(built.handles.get('m2')?.state).toBe(handles[2]?.state);
  });

  it('plays each member alone in its solo mix, the solos folding to the blend', () => {
    const built = compile(three(), subjects, { solos: true });
    for (let t = 0; t <= 600; t += FRAME) {
      built.mix.sync(t);
      for (const solo of built.solos.values()) solo.sync(t);
      for (const s of subjects) {
        const alone = [...built.solos.values()].map((solo) => solo.probe(s).scale);
        const moved = alone.filter((x) => Math.abs(x - 1) > 1e-9);
        expect(moved.length).toBeLessThanOrEqual(2);
        if (s.x === 0) expect(alone[0]).toBeCloseTo(built.mix.probe(s).scale, 9);
      }
    }
  });

  it('shares one reading as hats over evenly spaced stops', () => {
    expect([0, 1, 2].map((i) => stopOf(i, 3))).toEqual([0, 0.5, 1]);
    expect([0, 1, 2].map((i) => shareOf(0.25, i, 3))).toEqual([0.5, 0.5, 0]);
    expect(shareOf(0.7, 0, 1)).toBe(1);
  });

  it('errors on its signal, and on a member whose spec strays', () => {
    const bad = compile(blended([member(0), member(1)], '(s) => ('), subjects);
    expect(bad.errors.map((e) => [e.voice, e.field])).toEqual([['m0', 'blend']]);
    expect(bad.handles.size).toBe(0);
    const stray = compile(blended([member(0), member(1, { rate: 2 })]), subjects);
    expect(stray.errors.map((e) => [e.voice, e.field])).toEqual([['m1', 'locus']]);
    expect([...stray.handles.keys()]).toEqual(['m0']);
  });
});

describe('editing a blend', () => {
  it('makes an edit to one member on all, and leaves the patch and name alone', () => {
    const c = three();
    const next = withVoice(c, {
      ...member(1),
      rate: 2,
      name: 'mid',
      stagger: { code: '(s) => 9' },
    });
    expect(next.voices.map((v) => v.rate)).toEqual([2, 2, 2]);
    expect(next.voices.map((v) => v.stagger?.code)).toEqual(['(s) => 9', '(s) => 9', '(s) => 9']);
    expect(next.voices.map((v) => v.name)).toEqual(['m0', 'mid', 'm2']);
    expect(next.voices[0]?.patch).toBe(c.voices[0]?.patch);
  });

  it('gives a voice that joins the fields the blend shares', () => {
    const c = blended([member(0, { rate: 3 }), voice({ id: 'x', patch: patchOf(7) })]);
    const next = withVoice(c, { ...(c.voices[1] as Voice), locus: 'tone' });
    expect(next.voices.map((v) => v.rate)).toEqual([3, 3]);
    const dragged = applyEdit(c, { clip: 'x', kind: 'group', with: 'm0' });
    expect(dragged.voices.map((v) => [v.locus, v.rate])).toEqual([
      ['tone', 3],
      ['tone', 3],
    ]);
  });

  it('follows a score edit, and drops a blend left with no voices', () => {
    const moved = applyEdit(three(), { clip: 'm2', kind: 'move', start: 250 });
    expect(moved.voices.map((v) => v.start)).toEqual([250, 250, 250]);
    const c = blended([member(0)]);
    expect(withVoice(c, { ...member(0), locus: undefined }).blends).toBeUndefined();
    expect(syncBlend({ ...c, voices: [] }, 'm0').blends).toBeUndefined();
  });

  it('blends a locus from its first voice, and unblends it', () => {
    const plain = comp([member(0, { rate: 2 }), member(1)]);
    const on = setBlend(plain, 'tone', { code: BY });
    expect(on.blends).toEqual({ tone: { code: BY } });
    expect(on.voices.map((v) => v.rate)).toEqual([2, 2]);
    expect(setBlend(on, 'tone', undefined).blends).toBeUndefined();
  });
});

describe('a blend elsewhere', () => {
  it('loads, and refuses a signal that is no expression', () => {
    const c = three();
    expect(load(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(load({ ...c, blends: { tone: 'x' } })).toBeNull();
  });

  it('labels its clips, and feeds each voice from the one signal in the flow', () => {
    const c = blended([member(0), member(1)], 'level("k")');
    expect(clipsOf(c, subjects).clips.map((x) => x.label)).toEqual([
      'm0 · keys · blend',
      'm1 · keys · blend',
    ]);
    const edges = flowOf({ ...c, levels: [{ name: 'k', value: 0, min: 0, max: 1 }] }).edges;
    expect(edges.filter((e) => e.label === 'blend').map((e) => [e.from, e.to])).toEqual([
      ['level:k', 'voice:m0'],
      ['level:k', 'voice:m1'],
    ]);
  });
});
