import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const one = patch<string, Pose>(0, () => ({ x: 1 }), { writes: ['x'] });

const marksOf = (m: ReturnType<typeof mix<string, Pose>>) =>
  m.marks(0, 10_000).map((e) => `${e.mark}@${e.timestamp}`);

describe('fade at', () => {
  it('leaves the voice untouched until at, then begins exactly there', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: one, subjects: ['a'] });
    m.sync(100);
    h.fade({ at: 1000, over: 100 });
    m.sync(990);
    expect(m.probe('a').x).toBe(1);
    expect(h.state).toBe('live');
    m.sync(1016);
    expect(m.probe('a').x).toBeCloseTo(0.84, 9);
  });

  it('starts partway for an at already past', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: one, subjects: ['a'] });
    m.sync(500);
    h.fade({ at: 450, over: 100 });
    expect(m.probe('a').x).toBeCloseTo(0.5, 9);
  });

  it('is taken back by rise before it begins, with nothing changed', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: one, subjects: ['a'] });
    h.fade({ at: 1000, over: 100 });
    m.sync(500);
    h.rise();
    m.sync(1050);
    expect(m.probe('a').x).toBe(1);
    expect(h.state).toBe('live');
    expect(marksOf(m)).toEqual(['start@0', 'in@0']);
  });

  it('fixes out and end ahead, for marks and project', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: one, subjects: ['a'], fade: { out: 300 } });
    h.fade({ at: 1000, over: 100 });
    expect(marksOf(m)).toEqual(['start@0', 'in@0', 'out@1000', 'end@1100']);
    expect(m.project(1050).probe('a').x).toBeCloseTo(0.5, 9);
    expect(m.project(900).probe('a').x).toBe(1);
  });

  it('drops to nothing at exactly at with over 0', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: one, subjects: ['a'] });
    h.fade({ at: 1000, over: 0 });
    m.sync(999);
    expect(m.probe('a').x).toBe(1);
    m.sync(1000);
    expect(m.probe('a').x).toBe(0);
    expect(Number.isNaN(m.probe('a').x)).toBe(false);
    expect(h.state).toBe('done');
  });

  it('wins over an anchored out, and a seek back restores it', () => {
    const m = mix<string, Pose>(K, { history: { ms: 10_000, tape } });
    m.sync(0);
    m.cue({ patch: patch<string, Pose>(2000, () => ({ x: 0 }), { writes: ['x'] }), name: 'cut' });
    const h = m.cue({ patch: one, subjects: ['a'], anchor: { out: { after: 'cut' } } });
    m.sync(100);
    h.fade({ at: 600, over: 0 });
    m.sync(200);
    expect(marksOf(m).filter((e) => e.startsWith('out'))).toEqual(['out@600']);
    m.sync(700);
    expect(h.state).toBe('done');
    m.seek(300);
    expect(h.state).toBe('live');
    expect(m.probe('a').x).toBe(1);
  });
});
