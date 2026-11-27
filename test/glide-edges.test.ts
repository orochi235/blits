import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide } from '../src/motion.js';
import type { Patch } from '../src/types.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}

// Fine-stepped reference: friction, and at an edge the speed turned back with `r` of it kept.
function walk(x0: number, v0: number, tau: number, lo: number, hi: number, r: number, ms: number) {
  let x = x0;
  let v = v0;
  const h = 1e-6;
  for (let t = 0; t < ms / 1000 - 1e-12; t += h) {
    v += (-v / tau) * h;
    x += v * h;
    if (x > hi) {
      x = hi - (x - hi) * r;
      v = -v * r;
    } else if (x < lo) {
      x = lo + (lo - x) * r;
      v = -v * r;
    }
  }
  return x;
}

const play = (g: Patch<Part, Pose, void>, times: number[], lanes = true) => {
  const m = mix<Part, Pose>(K, { lanes });
  m.cue({ patch: g });
  const a = { id: 'a' };
  return times.map((t) => {
    m.sync(t);
    return m.probe(a).x;
  });
};
const times = [0, 50, 120, 300, 700, 1500, 5000];

describe("a glide's edge: 'stop'", () => {
  it('coasts as a springing edge does until it reaches the edge, then stays on it', () => {
    const opts = { from: 0, velocity: 1000, ms: 325, bounds: [0, 200] as const, settle: 0 };
    const stop = play(glide<Part, Pose>('x', { ...opts, edge: 'stop' }), times);
    const spring = play(glide<Part, Pose>('x', opts), times);
    const cross = -325 * Math.log(1 - 200 / 325);
    for (let i = 0; i < times.length; i++) {
      const t = times[i] as number;
      if (t < cross) expect(Object.is(stop[i], spring[i])).toBe(true);
      else expect(stop[i]).toBe(200);
    }
  });

  it('reads still on the edge once there', () => {
    const g = glide<Part, Pose>('x', {
      from: 0,
      velocity: -1000,
      bounds: [-50, 50],
      edge: 'stop',
    });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: g });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(400);
    m.probe(a);
    expect(g.read(a)).toEqual({ value: -50, velocity: 0 });
  });

  it('still springs back a subject let go past the edge', () => {
    const opts = { from: -60, bounds: [0, 500] as const, settle: 0 };
    const stop = play(glide<Part, Pose>('x', { ...opts, edge: 'stop' }), times);
    const spring = play(glide<Part, Pose>('x', opts), times);
    for (let i = 0; i < times.length; i++) expect(Object.is(stop[i], spring[i])).toBe(true);
  });

  it('is what a reflect of 0 is, and says so in its spec', () => {
    const g = glide<Part, Pose>('x', { from: 0, bounds: [0, 1], edge: { reflect: 0 } });
    expect(g.motion).toMatchObject({ kind: 'glide', edge: 'stop' });
  });
});

describe("a glide's edge: { reflect }", () => {
  for (const r of [1, 0.5]) {
    it(`turns back off each edge it meets with ${r} of its speed, the far one too`, () => {
      const g = glide<Part, Pose>('x', {
        from: 0,
        velocity: 3000,
        ms: 325,
        bounds: [-100, 100],
        edge: { reflect: r },
        settle: 0,
      });
      const at = [40, 100, 200, 350, 600, 1200, 4000];
      const xs = play(g, at);
      for (let i = 0; i < at.length; i++)
        expect(xs[i]).toBeCloseTo(walk(0, 3000, 0.325, -100, 100, r, at[i] as number), 1);
    });
  }

  it('comes to rest where its coast ends, landing exactly there', () => {
    const g = glide<Part, Pose>('x', {
      from: 0,
      velocity: 3000,
      ms: 325,
      bounds: [-100, 100],
      edge: { reflect: 0.5 },
    });
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: g });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(20_000);
    const end = m.probe(a).x;
    expect(end).toBeCloseTo(walk(0, 3000, 0.325, -100, 100, 0.5, 20_000), 1);
    expect(h.landed).toBe(true);
    expect(g.read(a)?.velocity).toBe(0);
  });

  it('bounces each axis off its own edges', () => {
    const g = glide<Part, Pose, number[]>('p', {
      from: [0, 0],
      velocity: [2000, -600],
      ms: 325,
      bounds: [
        [-100, -50],
        [100, 50],
      ],
      edge: { reflect: 1 },
      settle: 0,
    });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: g });
    const a = { id: 'a' };
    for (const t of [0, 150, 500, 3000]) {
      m.sync(t);
      const [px, py] = m.probe(a).p as number[];
      expect(px).toBeCloseTo(walk(0, 2000, 0.325, -100, 100, 1, t), 1);
      expect(py).toBeCloseTo(walk(0, -600, 0.325, -50, 50, 1, t), 1);
    }
  });

  it('gives the same pose to the bit on lanes and off', () => {
    const make = () =>
      glide<Part, Pose>('x', {
        from: 0,
        velocity: 2500,
        bounds: [-20, 250],
        edge: { reflect: 0.7 },
        settle: 0,
      });
    const on = play(make(), times, true);
    const off = play(make(), times, false);
    for (let i = 0; i < times.length; i++) expect(Object.is(on[i], off[i])).toBe(true);
  });

  it('plays again the same after a seek back across a push', () => {
    const g = glide<Part, Pose>('x', {
      from: 0,
      bounds: [-100, 100],
      edge: { reflect: 0.8 },
      settle: 0,
    });
    const m = mix<Part, Pose>(K, { history: { ms: Number.POSITIVE_INFINITY, tape } });
    m.cue({ patch: g });
    const a = { id: 'a' };
    const seen: number[] = [];
    for (let t = 0; t <= 1600; t += 16) {
      m.sync(t);
      if (t === 160) g.push(a, 2500);
      seen.push(m.probe(a).x);
    }
    m.seek(0);
    for (let t = 0, i = 0; t <= 1600; t += 16, i++) {
      m.sync(1600 + t);
      expect(m.probe(a).x).toBe(seen[i]);
    }
  });

  it('coasts a subject set past an edge on, unbounded, until the next push', () => {
    const g = glide<Part, Pose>('x', {
      from: 0,
      bounds: [0, 100],
      edge: { reflect: 1 },
      settle: 0,
    });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: g });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    g.set(a, 140);
    m.sync(2000);
    expect(m.probe(a).x).toBe(140);
    g.push(a, 0);
    m.sync(6000);
    expect(m.probe(a).x).toBeCloseTo(100, 6);
  });

  it('springs back a subject let go past an edge that does not coast back in', () => {
    const opts = { from: -60, bounds: [0, 500] as const, settle: 0 };
    const reflect = play(glide<Part, Pose>('x', { ...opts, edge: { reflect: 1 } }), times);
    const spring = play(glide<Part, Pose>('x', opts), times);
    for (let i = 0; i < times.length; i++) expect(reflect[i]).toBeCloseTo(spring[i] as number, 9);
  });

  it('refuses a restitution outside 0 to 1', () => {
    for (const reflect of [-0.1, 1.5, Number.NaN])
      expect(() => glide<Part, Pose>('x', { from: 0, bounds: [0, 1], edge: { reflect } })).toThrow(
        RangeError,
      );
  });
});
