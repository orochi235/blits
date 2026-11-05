import { describe, expect, it } from 'vitest';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { wave } from '../src/wave.js';
import { K, matches, type Part, type Pose, rng } from './trace-helpers.js';

const rise = keys<Part, Pose>(400, [
  { at: 0, delta: { x: 0 } },
  { at: 0.5, delta: { x: 10 }, ease: 'ease-in' },
  { at: 1, delta: { x: 4 } },
]);

describe('trace through fades', () => {
  it('is exact through a fade in, straight over a still value without bends', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: keys<Part, Pose>(0, [{ at: 0, delta: { x: 6 } }]), fade: { in: 200 } });
    m.probe(a);
    m.sync(50);
    const still = m.trace(50, 400).of(a, 'x');
    expect(still.exact).toBe(true);
    expect(still.at).toEqual([50, 200, 400]);
    matches(m, still, a, 'x');
    m.cue({ patch: rise, loop: true, fade: { in: 300, ease: 'ease-out' } });
    m.probe(a);
    const run = m.trace(50, 900, { bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    matches(m, run, a, 'x');
  });

  it("is exact through a voice's own fade out at its end", () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: rise, loop: 2, fade: { out: 150 } });
    m.probe(a);
    const run = m.trace(0, 1200, { bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toContain(950);
    matches(m, run, a, 'x');
  });

  it('is exact through a fade under way, one set ahead, and one turned back', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: rise, loop: true, fade: { in: 80 } });
    m.probe(a);
    m.sync(100);
    h.fade({ over: 300 });
    m.sync(120);
    const under = m.trace(120, 600, { bends: true }).of(a, 'x');
    expect(under.exact).toBe(true);
    matches(m, under, a, 'x');
    m.sync(200);
    h.rise({ over: 250 });
    m.sync(220);
    const back = m.trace(220, 800, { bends: true }).of(a, 'x');
    expect(back.exact).toBe(true);
    matches(m, back, a, 'x');
    h.fade({ at: 500, over: 200 });
    const ahead = m.trace(220, 900, { bends: true }).of(a, 'x');
    expect(ahead.exact).toBe(true);
    expect(ahead.at).toContain(500);
    matches(m, ahead, a, 'x');
  });

  it('samples a fade weighed above 1, which is held to 1 partway', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: rise, loop: true, weight: 2, fade: { in: 200 } });
    m.probe(a);
    expect(m.trace(0, 400, { bends: true }).of(a, 'x').exact).toBe(false);
  });
});

describe('trace over random scenes with ramps and fades', () => {
  it('agrees with project between its points wherever it says exact', () => {
    let exact = 0;
    let runs = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
      const a = { id: 'a' };
      const m = mix<Part, Pose>(K);
      m.sync(0);
      const voices = 1 + Math.floor(r() * 3);
      const handles = [];
      for (let v = 0; v < voices; v++) {
        const ch = pick(['x', 'x', 'gain'] as const);
        const n = 2 + Math.floor(r() * 3);
        const stops = Array.from({ length: n }, (_, i) => ({
          at: i === 0 ? 0 : i === n - 1 ? 1 : r(),
          delta: { [ch]: ch === 'gain' ? r() * 2 : r() * 20 - 10 },
          ease: r() < 0.3 ? pick(['ease-in', 'ease-in-out'] as const) : undefined,
        }));
        handles.push(
          m.cue({
            patch: keys<Part, Pose>(pick([120, 300]), stops),
            loop: pick([true, 2, 3]),
            start: pick([0, 0, 40]),
            weight: pick([1, 0.5]),
            freeze: pick([undefined, undefined, 'after'] as const),
            fade: pick([
              undefined,
              { in: 60 },
              { out: 90 },
              { in: 120, out: 50, ease: 'ease-in-out' },
            ] as const),
          }),
        );
      }
      m.probe(a);
      m.sync(30);
      m.probe(a);
      for (const h of handles) {
        const act = r();
        if (act < 0.25) h.ramp(pick([0.5, 2]), pick([60, 200]));
        else if (act < 0.4) h.fade({ over: pick([0, 80, 250]) });
        else if (act < 0.55) h.fade({ at: pick([100, 260]), over: pick([0, 120]) });
      }
      const now = pick([30, 60]);
      m.sync(now);
      m.probe(a);
      const t = m.trace(now, now + 700, { grid: 7, bends: true });
      for (const ch of ['x', 'gain'] as const) {
        const run = t.of(a, ch);
        runs++;
        if (!run.exact) continue;
        exact++;
        matches(m, run, a, ch, 3);
      }
    }
    // Nearly every run of these scenes is exact; a check that never runs proves nothing.
    expect(exact).toBeGreaterThan(runs * 0.8);
  });
});

describe('trace of a wave', () => {
  it.each(['sine', 'triangle', 'saw', 'square'] as const)(
    'is exact for a %s, its rate ramping or not',
    (shape) => {
      const a = { id: 'a' };
      const m = mix<Part, Pose>(K);
      m.sync(0);
      const h = m.cue({
        patch: wave<Part, Pose>(300, { shape, cycles: 2, phase: 0.1, depth: { x: 5, gain: 0.5 } }),
        loop: 3,
        fade: { in: 100 },
      });
      m.probe(a);
      m.sync(40);
      const steady = m.trace(40, 1000, { bends: true });
      expect(steady.of(a, 'x').exact).toBe(true);
      matches(m, steady.of(a, 'x'), a, 'x');
      matches(m, steady.of(a, 'gain'), a, 'gain');
      h.ramp(1.5, 200);
      m.sync(60);
      const ramped = m.trace(60, 1000, { bends: true }).of(a, 'x');
      expect(ramped.exact).toBe(true);
      matches(m, ramped, a, 'x');
    },
  );

  it('samples a patch of the host’s own', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: patch<Part, Pose>(300, (p) => ({ x: p * p }), { writes: ['x'] }) });
    expect(m.trace(0, 300, { bends: true }).of(a, 'x').exact).toBe(false);
  });
});
