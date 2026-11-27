import { describe, expect, it } from 'vitest';
import { affine } from '../src/affine.js';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';
import { rng } from './fuzz/rng.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}
type Read = { value: number[]; velocity: number[] };

/** Where a coast released at `x0` moving at `v0` stands `t` s on, with friction's time constant `tau`. */
const coastAt = (x0: number[], v0: number[], tau: number, t: number) =>
  x0.map((x, i) => x + (v0[i] as number) * tau * (1 - Math.exp(-t / tau)));

/**
 * A coast of `tau` s cued on two axes from `x0` at `v0` with `settleOn: 'speed'`, read every
 * `step` ms until its handle reads landed: each frame's value and velocity, and the frame it landed.
 */
function run(
  x0: number[],
  v0: number[],
  tau: number,
  settle: number,
  settleBy: 'axis' | 'length',
  step: number,
  as: 'spring' | 'glide',
) {
  const m = mix<Part, Pose>(K);
  const s =
    as === 'spring'
      ? spring<Part, Pose, number[]>('p', {
          from: x0,
          to: x0,
          velocity: v0,
          stiffness: 0,
          damping: 1 / tau,
          settle,
          settleBy,
          settleOn: 'speed',
        })
      : glide<Part, Pose, number[]>('p', {
          from: x0,
          velocity: v0,
          ms: tau * 1000,
          settle,
          settleBy,
          settleOn: 'speed',
        });
  const h = m.cue({ patch: s });
  const a = { id: 'a' };
  const frames: { t: number; read: Read }[] = [];
  let landedAt = Number.NaN;
  for (let t = 0; t < 600_000 && Number.isNaN(landedAt); t += step) {
    m.sync(t);
    m.probe(a);
    frames.push({ t, read: s.read(a) as Read });
    if (h.landed) landedAt = t;
  }
  return { frames, landedAt };
}

describe("settleOn: 'speed'", () => {
  it('lands a coast the first frame its speed as one length is within settle, where the coast stood then', () => {
    const x0 = [3, -2];
    const v0 = [40, -30];
    const tau = 19.5;
    const settle = 0.5;
    const { frames, landedAt } = run(x0, v0, tau, settle, 'length', 16, 'spring');
    // Speed 50 falls to 0.5 at τ·ln(100).
    const stops = tau * Math.log(100);
    expect(landedAt).toBe(Math.ceil((stops * 1000) / 16) * 16);
    const stop = coastAt(x0, v0, tau, stops);
    for (const { t, read } of frames) {
      if (t < landedAt) {
        const want = coastAt(x0, v0, tau, t / 1000);
        for (let i = 0; i < 2; i++) expect(read.value[i]).toBeCloseTo(want[i] as number, 9);
        expect(Math.hypot(...read.velocity)).toBeGreaterThan(settle);
      } else {
        for (let i = 0; i < 2; i++) expect(read.value[i]).toBeCloseTo(stop[i] as number, 9);
        expect(read.velocity).toEqual([0, 0]);
      }
    }
  });

  it('stops each axis on its own under the default settleBy', () => {
    const { frames, landedAt } = run([0, 0], [10, 1], 2, 0.5, 'axis', 10, 'glide');
    // The slow axis stops at 2·ln(2), the fast one at 2·ln(20).
    const slowStops = 2 * Math.log(2);
    expect(landedAt).toBe(Math.ceil((2 * Math.log(20) * 1000) / 10) * 10);
    const mid = frames.find((f) => f.t >= 2000);
    expect(mid?.read.velocity[1]).toBe(0);
    expect(mid?.read.value[1]).toBeCloseTo(1 * 2 * (1 - 0.5 / 1), 9);
    expect(mid?.read.velocity[0]).toBeGreaterThan(0.5);
    expect(slowStops).toBeLessThan(2);
  });

  it('agrees with the coast it stops, at random speeds, time constants, settles and frame rates', () => {
    const r = rng(0x5e771e);
    for (let n = 0; n < 60; n++) {
      const v0 = [(r.f() - 0.5) * 2000, (r.f() - 0.5) * 2000];
      const x0 = [(r.f() - 0.5) * 100, (r.f() - 0.5) * 100];
      const tau = 0.05 + r.f() * 4;
      const settle = 10 ** (-3 + r.f() * 3);
      const settleBy = r.pick(['axis', 'length'] as const);
      const step = 4 + r.i(30);
      const { frames, landedAt } = run(
        x0,
        v0,
        tau,
        settle,
        settleBy,
        step,
        r.pick(['spring', 'glide'] as const),
      );
      const slow = (v: number[]) =>
        settleBy === 'length'
          ? Math.hypot(...v) <= settle
          : v.every((vi) => Math.abs(vi) <= settle);
      // The frame it lands is the first whose coast is that slow.
      const first = frames.find((f) => {
        const e = Math.exp(-f.t / 1000 / tau);
        return slow(v0.map((vi) => vi * e));
      });
      expect(landedAt, `case ${n}`).toBe(first?.t);
      // And it never moves past where it stops, or back.
      const end = (frames[frames.length - 1] as { read: Read }).read.value;
      for (let i = 0; i < 2; i++) {
        const dir = Math.sign(v0[i] as number);
        for (const f of frames)
          expect(((end[i] as number) - (f.read.value[i] as number)) * dir).toBeGreaterThanOrEqual(
            -1e-9,
          );
      }
    }
  });

  it('says so in its spec, and refuses what is no coast', () => {
    expect(
      spring<Part, Pose>('x', { to: 0, stiffness: 0, settleOn: 'speed' }).motion,
    ).toMatchObject({
      settleOn: 'speed',
    });
    expect(glide<Part, Pose>('x', { from: 0, settleOn: 'speed' }).motion).toMatchObject({
      kind: 'glide',
      settleOn: 'speed',
    });
    expect(glide<Part, Pose>('x', { from: 0 }).motion).not.toHaveProperty('settleOn');
    expect(
      spring<Part, Pose>('x', { to: 0, stiffness: 0, settleOn: 'reach' }).motion,
    ).not.toHaveProperty('settleOn');
    expect(() => spring<Part, Pose>('x', { to: 0, settleOn: 'speed' })).toThrow(RangeError);
    expect(() => glide<Part, Pose>('x', { from: 0, bounds: [-1, 1], settleOn: 'speed' })).toThrow(
      RangeError,
    );
    expect(() =>
      spring<Part, Pose>('x', { to: 0, stiffness: 0, settleOn: 'slow' as unknown as 'speed' }),
    ).toThrow(RangeError);
  });

  it('refuses a channel whose values lie in a space', () => {
    interface T {
      m: number[];
    }
    const m = mix<Part, T>(kit<T>({ m: affine() }));
    const id = [1, 0, 0, 1, 0, 0];
    expect(() => {
      m.cue({
        patch: glide<Part, T, number[]>('m', {
          from: id,
          velocity: [0, 0, 0, 0, 5, 5],
          settleOn: 'speed',
        }),
      });
      m.sync(0);
      m.probe({ id: 'a' });
    }).toThrow(/settleOn/);
  });
});
