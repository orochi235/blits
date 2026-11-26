import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });

/** Fine-stepped RK4 of m·x'' = −k(x − to) − c·x', the reference the closed forms must match. */
function integrate(
  k: number,
  c: number,
  m: number,
  x0: number,
  v0: number,
  to: number,
  ms: number,
): { x: number; v: number } {
  let x = x0;
  let v = v0;
  const h = 1e-5;
  const f = (xx: number, vv: number) => (-k * (xx - to) - c * vv) / m;
  const steps = Math.round(ms / 1000 / h);
  for (let i = 0; i < steps; i++) {
    const k1x = v;
    const k1v = f(x, v);
    const k2x = v + (h / 2) * k1v;
    const k2v = f(x + (h / 2) * k1x, v + (h / 2) * k1v);
    const k3x = v + (h / 2) * k2v;
    const k3v = f(x + (h / 2) * k2x, v + (h / 2) * k2v);
    const k4x = v + h * k3v;
    const k4v = f(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return { x, v };
}

/** Each law the closed forms gained: no damping, no stiffness, and neither. */
const LAWS = [
  { name: 'no damping', stiffness: 120, damping: 0, mass: 2 },
  { name: 'no stiffness', stiffness: 0, damping: 5, mass: 2 },
  { name: 'neither', stiffness: 0, damping: 0, mass: 2 },
] as const;

const a = { id: 'a' };

describe('a spring with a constant at 0', () => {
  for (const law of LAWS)
    it(`matches a fine numerical solution with ${law.name}`, () => {
      for (const ms of [50, 300, 1000, 2500]) {
        const s = spring<Part, Pose>('x', {
          from: 10,
          to: 100,
          velocity: 240,
          settle: 0,
          ...law,
        });
        const m = mix<Part, Pose>(K, { name: law.name });
        m.cue({ patch: s });
        for (let t = 0; t < ms; t += 16) {
          m.sync(t);
          m.probe(a);
        }
        m.sync(ms);
        const want = integrate(law.stiffness, law.damping, law.mass, 10, 240, 100, ms);
        expect(m.probe(a).x).toBeCloseTo(want.x, 6);
        expect((s.read(a) as { velocity: number }).velocity).toBeCloseTo(want.v, 5);
      }
    });

  it('with no stiffness coasts as a glide of ms 1000 · mass / damping, and its target changes nothing', () => {
    const s = spring<Part, Pose>('x', {
      from: 0,
      to: 500,
      velocity: 300,
      stiffness: 0,
      damping: 4,
    });
    const g = glide<Part, Pose>('x', { from: 0, velocity: 300, ms: 250 });
    const ms = mix<Part, Pose>(K, { name: 'spring' });
    const mg = mix<Part, Pose>(K, { name: 'glide' });
    ms.cue({ patch: s });
    mg.cue({ patch: g });
    for (let t = 0; t <= 6000; t += 16) {
      if (t === 400) s.to(a, -900);
      ms.sync(t);
      mg.sync(t);
      expect(ms.probe(a).x).toBeCloseTo(mg.probe(a).x, 9);
    }
    expect(ms.probe(a).x).toBe(75);
  });

  it('with neither moves on at its velocity for good, and one within settle stays put', () => {
    const s = spring<Part, Pose>('x', { from: 3, to: 0, velocity: 40, stiffness: 0, damping: 0 });
    const m = mix<Part, Pose>(K, { name: 'drift' });
    m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    m.sync(10_000);
    expect(m.probe(a).x).toBeCloseTo(403, 9);
    const still = spring<Part, Pose>('x', {
      from: 3,
      to: 0,
      velocity: 1e-5,
      stiffness: 0,
      damping: 0,
    });
    const n = mix<Part, Pose>(K, { name: 'still' });
    n.cue({ patch: still });
    for (const t of [0, 10, 1e6]) {
      n.sync(t);
      expect(n.probe(a).x).toBe(3);
    }
    expect((still.read(a) as { velocity: number }).velocity).toBe(0);
    const creeping = spring<Part, Pose>('x', {
      from: 3,
      to: 0,
      velocity: 1.00000001e-4,
      stiffness: 0,
      damping: 0,
    });
    const c = mix<Part, Pose>(K, { name: 'creeping' });
    c.cue({ patch: creeping });
    c.sync(0);
    c.probe(a);
    c.sync(1e6);
    expect(c.probe(a).x).toBeCloseTo(3.100000001, 12);
  });

  for (const law of LAWS)
    for (const change of ['to', 'push'] as const)
      it(`keeps position and velocity through a ${change} with ${law.name}`, () => {
        const s = spring<Part, Pose>('x', { from: 0, to: 100, velocity: 50, settle: 0, ...law });
        const m = mix<Part, Pose>(K, { name: change });
        m.cue({ patch: s });
        m.sync(0);
        m.probe(a);
        if (change === 'to') s.to(a, -50, 200);
        else s.push(a, -80, 200);
        m.sync(400);
        m.probe(a);
        const before = s.read(a, 200 - 1e-6) as { value: number; velocity: number };
        const after = s.read(a, 200 + 1e-6) as { value: number; velocity: number };
        expect(after.value).toBeCloseTo(before.value, 4);
        if (change === 'to') expect(after.velocity).toBeCloseTo(before.velocity, 3);
        else expect(after.velocity).toBeCloseTo(-80, 3);
      });

  for (const law of LAWS)
    it(`plays the same live, projected and sought with ${law.name}`, () => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100, velocity: 50, ...law });
      const m = mix<Part, Pose>(K, { name: 'seek', history: { ms: 5000, tape } });
      m.cue({ patch: s });
      const live = new Map<number, number>();
      for (let t = 0; t <= 800; t += 16) {
        if (t === 160) s.to(a, -40);
        if (t === 320) s.push(a, 90);
        m.sync(t);
        live.set(t, m.probe(a).x);
      }
      m.seek(48);
      for (const t of [96, 208, 400, 800]) expect(m.project(t).probe(a).x).toBe(live.get(t));
      m.seek(400);
      expect(m.probe(a).x).toBe(live.get(400));
      m.seek(800);
      expect(m.probe(a).x).toBe(live.get(800));
    });

  it.each([
    { stiffness: -1 },
    { mass: 0 },
    { damping: -1 },
    { stiffness: Number.NaN },
    { damping: Number.POSITIVE_INFINITY },
  ])('still refuses %j', (opts) => {
    expect(() => spring<Part, Pose>('x', { to: 0, ...opts })).toThrow(RangeError);
  });
});
