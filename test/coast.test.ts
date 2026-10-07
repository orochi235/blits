import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });

const hold = (ms: number) => patch<string, Pose>(ms, () => ({ x: 1 }), { writes: ['x'] });

const marksOf = (m: ReturnType<typeof mix<string, Pose>>, name: string) =>
  m
    .marks(0, 10_000)
    .filter((e) => e.name === name)
    .map((e) => `${e.mark}@${e.timestamp}`);

describe('coast', () => {
  it('falls with out for a voice that does not freeze, known ahead', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false, fade: { out: 100 } });
    expect(marksOf(m, 'a')).toEqual(['start@0', 'in@0', 'coast@300', 'out@300', 'end@400']);
  });

  it('falls where a frozen voice starts showing its last frame, which has no out', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'run', loop: 2, freeze: 'both' });
    m.cue({ patch: hold(100), name: 'next', anchor: { start: { of: 'run', mark: 'coast' } } });
    m.sync(700);
    expect(marksOf(m, 'run')).toEqual(['start@0', 'in@0', 'coast@600']);
    expect(marksOf(m, 'next')[0]).toBe('start@600');
  });

  it('never falls for a voice that loops for good', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: true });
    m.sync(1000);
    expect(marksOf(m, 'a')).toEqual(['start@0', 'in@0']);
  });

  it('never falls for a voice faded before its last pass ends', async () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: hold(300), name: 'a', loop: 2, fade: { out: 100 } });
    m.sync(150);
    h.fade();
    m.sync(200);
    expect(marksOf(m, 'a')).toEqual(['start@0', 'in@0', 'out@150', 'end@250']);
    m.sync(400);
    expect(await h.played).toBe(false);
  });

  it('waits for the latest-staggered subject', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const delay: Record<string, number> = { a: 0, b: 100, c: 200 };
    m.cue({
      patch: hold(300),
      name: 'v',
      loop: false,
      freeze: 'after',
      stagger: (s) => delay[s] ?? 0,
    });
    m.sync(10);
    for (const s of ['a', 'b', 'c']) m.probe(s);
    expect(marksOf(m, 'v')).toContain('coast@500');
  });

  it('moves with the voice rate', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false, rate: 0.5, freeze: 'after' });
    expect(marksOf(m, 'a')).toContain('coast@600');
  });

  it('falls for an owner when its last child coasts', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const o = m.owns({ name: 'o' });
    m.cue({ patch: hold(300), loop: false, owner: o, freeze: 'after' });
    m.cue({ patch: hold(500), loop: false, owner: o, start: 100 });
    expect(marksOf(m, 'o')).toContain('coast@600');
  });

  it('is read by a projection ahead', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'run', loop: false, freeze: 'after', subjects: ['r'] });
    m.cue({
      patch: patch<string, Pose>(100, () => ({ x: 10 }), { writes: ['x'] }),
      subjects: ['r'],
      loop: false,
      anchor: { start: { of: 'run', mark: 'coast', by: 50 } },
    });
    expect(m.project(340).probe('r').x).toBe(1);
    expect(m.project(360).probe('r').x).toBe(11);
  });
});
