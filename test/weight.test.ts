import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { level } from '../src/signals.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const crawl = patch<Part, Pose>(0, () => ({ crawl: 10 }), { writes: ['crawl'] });

describe('handle.weightOf', () => {
  it('reads the weight a voice gave a subject through its fade in and out', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: crawl, weight: 0.5, fade: { in: 100, out: 100 } });
    m.sync(0);
    m.probe(a);
    expect(h.weightOf(a)).toBe(0);
    m.sync(50);
    m.probe(a);
    expect(h.weightOf(a)).toBeCloseTo(0.25, 12);
    m.sync(100);
    m.probe(a);
    expect(h.weightOf(a)).toBeCloseTo(0.5, 12);
    h.fade();
    m.sync(175);
    m.probe(a);
    expect(h.weightOf(a)).toBeCloseTo(0.125, 12);
    m.sync(200);
    m.probe(a);
    expect(h.weightOf(a)).toBe(0);
  });

  it('follows a weight signal per subject', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const k = level<Part>(0.3);
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: crawl, weight: (s, setting) => (s.id === 'a' ? k(s, setting) : 0.9) });
    m.sync(0);
    m.probe(a);
    m.probe(b);
    expect(h.weightOf(a)).toBeCloseTo(0.3, 12);
    expect(h.weightOf(b)).toBeCloseTo(0.9, 12);
    k.set(0.7);
    m.sync(16);
    m.probe(a);
    expect(h.weightOf(a)).toBeCloseTo(0.7, 12);
  });

  it('is 0 for a subject it does not reach, has not reached yet, or has never been probed for', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(PART);
    const only = m.cue({ patch: crawl, target: (s) => s.id === 'a' });
    const late = m.cue({ patch: crawl, stagger: () => 100 });
    m.sync(0);
    m.probe(b);
    expect(only.weightOf(b)).toBe(0);
    expect(only.weightOf(a)).toBe(0);
    expect(late.weightOf(b)).toBe(0);
    m.sync(100);
    m.probe(b);
    expect(late.weightOf(b)).toBe(1);
  });

  it('is the voice weight before a locus folds it with its alternatives', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(PART);
    const one = m.cue({ patch: crawl, weight: 0.8, locus: 'l' });
    const two = m.cue({ patch: crawl, weight: 0.6, locus: 'l' });
    m.sync(0);
    m.probe(a);
    expect(one.weightOf(a)).toBeCloseTo(0.8, 12);
    expect(two.weightOf(a)).toBeCloseTo(0.6, 12);
  });
});
