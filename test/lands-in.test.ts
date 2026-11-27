import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import type { Handle, Patch } from '../src/types.js';
import { rng } from './fuzz/rng.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}
const a = { id: 'a' };

/** Cues `patch`, steps it `step` ms a frame, and answers each frame's `landsIn` and the frame it landed. */
function run<S>(patch: Patch<Part, Pose, S>, step: number, limit = 120_000) {
  const m = mix<Part, Pose>(K);
  const h: Handle<Part> = m.cue({ patch });
  const asked: { t: number; landsIn: number }[] = [];
  for (let t = 0; t < limit; t += step) {
    m.sync(t);
    m.probe(a);
    if (h.landed) return { asked, landedAt: t, h };
    asked.push({ t, landsIn: h.landsIn });
  }
  return { asked, landedAt: Number.NaN, h };
}

describe("a handle's landsIn", () => {
  it('never says later than the frame a spring or a coast lands', () => {
    const r = rng(0x1a4d5);
    for (let n = 0; n < 150; n++) {
      const settle = 10 ** (-4 + r.f() * 3);
      const settleBy = r.pick(['axis', 'length'] as const);
      const from = [(r.f() - 0.5) * 400, (r.f() - 0.5) * 400];
      const velocity = [(r.f() - 0.5) * 3000, (r.f() - 0.5) * 3000];
      const kind = r.pick(['spring', 'coast', 'slow', 'glide'] as const);
      const patch =
        kind === 'spring'
          ? spring<Part, Pose, number[]>('p', {
              from,
              to: [0, 0],
              velocity,
              stiffness: 20 + r.f() * 400,
              damping: 2 + r.f() * 60,
              mass: 0.2 + r.f() * 3,
              settle,
              settleBy,
            })
          : kind === 'glide'
            ? glide<Part, Pose, number[]>('p', {
                from,
                velocity,
                ms: 50 + r.f() * 2000,
                settle,
                settleBy,
              })
            : spring<Part, Pose, number[]>('p', {
                from,
                to: from,
                velocity,
                stiffness: 0,
                damping: 0.2 + r.f() * 20,
                settle,
                settleBy,
                settleOn: kind === 'slow' ? 'speed' : 'reach',
              });
      const step = 4 + r.i(30);
      const { asked, landedAt } = run(patch, step, 600_000);
      expect(landedAt, `case ${n} ${kind}`).toBeGreaterThan(0);
      for (const { t, landsIn } of asked)
        expect(t + landsIn, `case ${n} ${kind} at ${t}`).toBeLessThanOrEqual(landedAt);
      // And it says something: a bound of 0 throughout would pass the rest.
      expect((asked[0] as { landsIn: number }).landsIn, `case ${n} ${kind}`).toBeGreaterThan(0);
    }
  });

  it('is exact for a coast that lands on its speed', () => {
    const tau = 2;
    const { asked } = run(
      glide<Part, Pose>('x', {
        from: 0,
        velocity: 100,
        ms: tau * 1000,
        settle: 1,
        settleOn: 'speed',
      }),
      16,
    );
    expect((asked[0] as { landsIn: number }).landsIn).toBeCloseTo(tau * 1000 * Math.log(100), 3);
  });

  it("is a tween's time left, 0 once landed, and Infinity for a spring with no damping", () => {
    const tw = run(tween<Part, Pose>('x', { from: 0, to: 1, ms: 500 }), 100);
    expect(tw.asked.map((q) => q.landsIn)).toEqual([500, 400, 300, 200, 100]);
    expect(tw.h.landsIn).toBe(0);
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: spring<Part, Pose>('x', { from: 0, to: 1, damping: 0 }) });
    m.sync(0);
    m.probe(a);
    m.sync(16);
    m.probe(a);
    expect(h.landsIn).toBe(Number.POSITIVE_INFINITY);
    h.fade({ over: 0 });
    m.sync(32);
    m.probe(a);
    expect(h.landsIn).toBe(Number.POSITIVE_INFINITY);
  });

  it('is 0 while a change waits', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 1 });
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    m.sync(16);
    m.probe(a);
    expect(h.landsIn).toBeGreaterThan(0);
    h.to(a, 5);
    expect(h.landsIn).toBe(0);
  });
});
