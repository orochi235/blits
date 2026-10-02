import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}

// Fine-stepped RK4 of m·x'' = −k(x − to) − c·x', the reference the closed form must match.
function integrate(k: number, c: number, x0: number, v0: number, to: number, ms: number): number {
  let x = x0;
  let v = v0;
  const h = 1e-5;
  const f = (xx: number, vv: number) => -k * (xx - to) - c * vv;
  for (let t = 0; t < ms / 1000 - 1e-12; t += h) {
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
  return x;
}

const playTo = (s: ReturnType<typeof spring<Part, Pose>>, every: number, until: number) => {
  const m = mix<Part, Pose>(K);
  m.cue({ patch: s });
  const a = { id: 'a' };
  for (let t = 0; t < until; t += every) {
    m.sync(t);
    m.probe(a);
  }
  m.sync(until);
  return { m, a, x: m.probe(a).x };
};

describe('spring', () => {
  for (const [name, k, c] of [
    ['under-damped', 180, 12],
    ['critically damped', 100, 20],
    ['over-damped', 100, 50],
  ] as const) {
    it(`matches a fine numerical solution when ${name}`, () => {
      for (const ms of [50, 150, 300, 700]) {
        const s = spring<Part, Pose>('x', {
          from: 0,
          to: 100,
          stiffness: k,
          damping: c,
          settle: 0,
        });
        expect(playTo(s, 16, ms).x).toBeCloseTo(integrate(k, c, 0, 0, 100, ms), 6);
      }
    });
  }

  it('lands in the same place at any frame rate', () => {
    const at = (fps: number) =>
      playTo(
        spring<Part, Pose>('x', { from: 0, to: 100, stiffness: 180, damping: 12 }),
        1000 / fps,
        300,
      ).x;
    const exact = at(240);
    for (const fps of [144, 120, 60, 30, 24]) expect(at(fps)).toBeCloseTo(exact, 9);
  });

  it('keeps position and velocity through a retarget, so the curve does not kink', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100, stiffness: 180, damping: 12, settle: 0 });
    const { m, a } = playTo(s, 16, 100);
    const before = s.read(a) as { value: number; velocity: number };
    expect(before.velocity).toBeGreaterThan(100);
    s.to(a, -50);
    m.sync(100.0001);
    m.probe(a);
    const after = s.read(a) as { value: number; velocity: number };
    expect(after.value).toBeCloseTo(before.value, 2);
    expect(after.velocity).toBeCloseTo(before.velocity, 0);
    m.sync(4000);
    expect(m.probe(a).x).toBeCloseTo(-50, 3);
  });

  it('a retarget at a stated time lands the same however the frames fall', () => {
    const run = (every: number) => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100, stiffness: 180, damping: 12 });
      s.to({ id: 'unused' }, 0);
      const m = mix<Part, Pose>(K);
      m.cue({ patch: s });
      const a = { id: 'a' };
      s.to(a, -50, 120);
      for (let t = 0; t < 400; t += every) {
        m.sync(t);
        m.probe(a);
      }
      m.sync(400);
      return m.probe(a).x;
    };
    const exact = run(5);
    for (const every of [7, 16.7, 33.3, 41]) expect(run(every)).toBeCloseTo(exact, 9);
  });

  it('springs each axis of a vector on its own', () => {
    const s = spring<Part, Pose, number[]>('p', { from: [0, 10], to: [100, 10], settle: 0 });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: s });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(200);
    const [x, y] = m.probe(a).p as number[];
    expect(x).toBeCloseTo(integrate(170, 26, 0, 0, 100, 200), 6);
    expect(y).toBe(10);
  });

  it('settles onto its target exactly, so the mix sees rest', () => {
    const s = spring<Part, Pose>('x', { from: 1, to: 0 });
    const { m, a } = playTo(s, 16, 3000);
    expect(m.probe(a).x).toBe(0);
    expect(m.atRest(a)).toBe(true);
  });

  it('a push changes velocity mid-flight and keeps the target', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 0, settle: 0 });
    const { m, a } = playTo(s, 16, 100);
    s.push(a, 500);
    m.sync(100.0001);
    m.probe(a);
    expect((s.read(a) as { velocity: number }).velocity).toBeCloseTo(500, 0);
    m.sync(3000);
    expect(m.probe(a).x).toBeCloseTo(0, 3);
  });
});

describe('glide', () => {
  it('comes to rest velocity · ms past where it was released', () => {
    const g = glide<Part, Pose>('x', { from: 10, velocity: 400, ms: 250 });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: g });
    const a = { id: 'a' };
    m.sync(0);
    expect(m.probe(a).x).toBe(10);
    m.sync(5000);
    expect(m.probe(a).x).toBeCloseTo(10 + 400 * 0.25, 6);
  });

  it('starts at the velocity it was given, and a push continues from where it is', () => {
    const g = glide<Part, Pose>('x', { from: 0, velocity: 400, ms: 250, settle: 0 });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: g });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    expect((g.read(a, 0) as { velocity: number }).velocity).toBeCloseTo(400, 9);
    m.sync(100);
    const there = m.probe(a).x;
    g.push(a, -200);
    m.sync(100.0001);
    expect(m.probe(a).x).toBeCloseTo(there, 2);
    m.sync(5000);
    expect(m.probe(a).x).toBeCloseTo(there - 200 * 0.25, 3);
  });
});

describe('the motion form', () => {
  it('spring and glide are form motion, carrying their constants as data', () => {
    const s = spring<Part, Pose>('x', { to: 1, stiffness: 120, damping: 14 });
    expect(s.form).toBe('motion');
    expect(s.motion).toEqual({
      kind: 'spring',
      stiffness: 120,
      damping: 14,
      mass: 1,
      settle: 1e-4,
    });
    const g = glide<Part, Pose>('x', { from: 0, ms: 200, settle: 0 });
    expect(g.form).toBe('motion');
    expect(g.motion).toEqual({ kind: 'glide', ms: 200, settle: 0 });
  });

  it('seeked back past a retarget it kept history of, plays the stretch from before it', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    const h = m.cue({ patch: s });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(300);
    const before = m.probe(a).x;
    s.to(a, -50, 500);
    m.sync(1000);
    m.probe(a);
    h.seek(200);
    m.sync(1100);
    expect(m.probe(a).x).toBe(before);
  });

  it('reads nothing with no time given until a frame has read the subject', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const a = { id: 'a' };
    s.to(a, 50, 0);
    expect(s.read(a)).toBeUndefined();
    expect(s.read(a, 0)).toEqual({ value: 0, velocity: 0 });
  });

  it('refuses a retarget or push on another number of axes, leaving the subject as it was', () => {
    const run = (bad?: (s: ReturnType<typeof spring<Part, Pose, number[]>>, a: Part) => void) => {
      const s = spring<Part, Pose, number[]>('p', { from: [0, 0], to: [1, 2] });
      const m = mix<Part, Pose>(K);
      m.cue({ patch: s });
      const a = { id: 'a' };
      m.sync(0);
      m.probe(a);
      s.to(a, [5, 6], 100);
      if (bad) expect(() => bad(s, a)).toThrow(/same number of axes/);
      return [200, 400, 800].map((t) => {
        m.sync(t);
        return [...m.probe(a).p];
      });
    };
    const clean = run();
    expect(run((s, a) => s.to(a, [1, 2, 3]))).toEqual(clean);
    expect(run((s, a) => s.to(a, [5]))).toEqual(clean);
    expect(run((s, a) => s.push(a, [1, 2, 3]))).toEqual(clean);
  });

  it('refuses a subject whose own start, target and velocity disagree on how many axes', () => {
    const s = spring<Part, Pose, number[]>('p', {
      from: (part) => (part.id === 'b' ? [0, 0] : [0, 0, 0]),
      to: [1, 2, 3],
    });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: s });
    m.sync(0);
    expect(() => m.probe({ id: 'b' })).toThrow(/same number of axes/);
    const v = spring<Part, Pose, number[]>('p', { to: [1, 2], velocity: [1, 2, 3] });
    const n = mix<Part, Pose>(K);
    n.cue({ patch: v });
    n.sync(0);
    expect(() => n.probe({ id: 'a' })).toThrow(/same number of axes/);
    const b = { id: 'b' };
    expect(() => s.to(b, [1, 2, 3])).toThrow(/same number of axes/);
    expect(s.read(b, 0)).toBeUndefined();
  });

  it('refuses subjects moving on different numbers of axes', () => {
    const s = spring<Part, Pose, number[]>('p', {
      to: (part) => (part.id === 'a' ? [1, 2] : [1, 2, 3]),
    });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: s });
    m.sync(0);
    m.probe({ id: 'a' });
    expect(() => m.probe({ id: 'b' })).toThrow(/same number of axes/);
  });
});
