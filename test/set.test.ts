import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };

describe('set', () => {
  for (const lanes of [false, true]) {
    it(`puts a glide where it says and lets it coast on at its velocity, lanes ${lanes}`, () => {
      const g = glide<typeof a, Pose>('x', { from: 0, velocity: 400, ms: 250, settle: 0 });
      const m = mix<typeof a, Pose>(K, { lanes });
      m.cue({ patch: g });
      m.sync(0);
      m.probe(a);
      m.sync(100);
      m.probe(a);
      const v = g.read(a)?.velocity as number;
      g.set(a, 1000);
      expect(g.read(a)?.value).toBe(1000);
      expect(g.read(a)?.velocity).toBeCloseTo(v, 9);
      m.sync(10_000);
      expect(m.probe(a).x).toBeCloseTo(1000 + v * 0.25, 6);
    });
  }

  it('follows a drag exactly, then flings from where it was let go', () => {
    const g = glide<typeof a, Pose>('x', { from: 0, ms: 325, settle: 0 });
    const m = mix<typeof a, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(a);
    for (const [t, x] of [
      [16, 5],
      [32, 12],
      [48, 20],
    ] as const) {
      m.sync(t);
      g.set(a, x);
      expect(m.probe(a).x).toBe(x);
    }
    g.push(a, 500);
    m.sync(10_000);
    expect(m.probe(a).x).toBeCloseTo(20 + 500 * 0.325, 6);
  });

  it('moves a spring and keeps it heading for its target', () => {
    const s = spring<typeof a, Pose>('x', { from: 0, to: 100 });
    const m = mix<typeof a, Pose>(K);
    m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    m.sync(50);
    m.probe(a);
    const v = s.read(a)?.velocity as number;
    s.set(a, -40);
    expect(s.read(a)?.value).toBe(-40);
    expect(s.read(a)?.velocity).toBeCloseTo(v, 9);
    m.sync(5000);
    expect(m.probe(a).x).toBeCloseTo(100, 3);
  });

  it('starts a tween over its full ms again from where it was put', () => {
    const t = tween<typeof a, Pose>('x', { from: 0, to: 100, ms: 200, ease: 'linear' });
    const m = mix<typeof a, Pose>(K);
    m.cue({ patch: t });
    m.sync(0);
    m.probe(a);
    m.sync(100);
    m.probe(a);
    t.set(a, 60);
    m.sync(200);
    expect(m.probe(a).x).toBeCloseTo(80, 6);
    m.sync(300);
    expect(m.probe(a).x).toBe(100);
  });

  it('plays a set again after a seek back past it', () => {
    const g = glide<typeof a, Pose>('x', { from: 0, ms: 300, settle: 0 });
    const m = mix<typeof a, Pose>(K, { history: { ms: 5000 } });
    const h = m.cue({ patch: g });
    m.sync(0);
    m.probe(a);
    m.sync(100);
    m.probe(a);
    g.set(a, 50);
    g.push(a, 200);
    m.sync(400);
    const live = m.probe(a).x;
    h.seek(50);
    m.sync(750);
    expect(m.probe(a).x).toBeCloseTo(live, 9);
  });
});
