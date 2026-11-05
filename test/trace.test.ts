import { describe, expect, it } from 'vitest';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys } from '../src/patch.js';
import { level } from '../src/signals.js';
import { K, matches, type Part, type Pose, rng } from './trace-helpers.js';

const ramp = keys<Part, Pose>(400, [
  { at: 0, delta: { x: 0 } },
  { at: 0.25, delta: { x: 10 } },
  { at: 0.75, delta: { x: -10 } },
  { at: 1, delta: { x: 0 } },
]);

describe('trace', () => {
  it('gives a keys voice its own breakpoints, exactly', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp, loop: true });
    m.sync(10);
    const run = m.trace(10, 410).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toEqual([10, 100, 300, 400, 410]);
    expect(run.value[1]).toBeCloseTo(10, 9);
    expect(run.value[2]).toBeCloseTo(-10, 9);
    matches(m, run, a, 'x');
  });

  it('gives two points at one time for a jump', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const saw = keys<Part, Pose>(100, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 10 } },
    ]);
    m.cue({ patch: saw, loop: true });
    m.cue({ patch: keys<Part, Pose>(0, [{ at: 0, delta: { x: 5 } }]), start: 150 });
    m.sync(20);
    const run = m.trace(20, 220).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toEqual([20, 100, 100, 150, 150, 200, 200, 220]);
    expect(run.value[1]).toBeCloseTo(10, 9);
    expect(run.value[2]).toBeCloseTo(0, 9);
    expect(run.value[3]).toBeCloseTo(5, 9);
    expect(run.value[4]).toBeCloseTo(10, 9);
    matches(m, run, a, 'x');
  });

  it('sums voices, staggers and delays exactly', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp, loop: 2, stagger: (s) => (s.id === 'b' ? 70 : 0), weight: 0.5 });
    const late = keys<Part, Pose>(
      300,
      [
        { at: 0, delta: { x: 0 } },
        { at: 0.5, delta: { x: 4 } },
        { at: 1, delta: { x: 1 } },
      ],
      { delayBy: () => 60 },
    );
    m.cue({ patch: late, start: 30, freeze: 'after' });
    m.sync(5);
    for (const s of [a, b]) {
      // To 790: past a subject's own end, a staggered voice leaves when its last subject ends.
      const run = m.trace(5, 790).of(s, 'x');
      expect(run.exact).toBe(true);
      matches(m, run, s, 'x');
    }
  });

  it('is exact for one voice on a mul channel, not two', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const g = keys<Part, Pose>(200, [
      { at: 0, delta: { gain: 1 } },
      { at: 1, delta: { gain: 0 } },
    ]);
    m.cue({ patch: g, weight: 0.8 });
    m.sync(1);
    const one = m.trace(1, 150).of(a, 'gain');
    expect(one.exact).toBe(true);
    matches(m, one, a, 'gain');
    m.cue({ patch: g });
    m.sync(2);
    const two = m.trace(2, 150, { grid: 10 }).of(a, 'gain');
    expect(two.exact).toBe(false);
    matches(m, two, a, 'gain', 1, 11);
  });

  it('samples on the grid where a voice is eased, between its exact breakpoints', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const eased = keys<Part, Pose>(
      200,
      [
        { at: 0, delta: { x: 0 } },
        { at: 0.5, delta: { x: 10 } },
        { at: 1, delta: { x: 0 }, ease: 'ease-in' },
      ],
      {},
    );
    m.cue({ patch: eased });
    m.sync(0);
    const run = m.trace(0, 200, { grid: 20 }).of(a, 'x');
    expect(run.exact).toBe(false);
    // The straight half is two points; the eased half is read every 20 ms.
    expect(run.at).toEqual([0, 100, 120, 140, 160, 180, 200]);
    for (let i = 0; i < run.at.length - 1; i++)
      expect(run.value[i]).toBeCloseTo(m.project(run.at[i] as number).probe(a).x, 4);
  });

  it('gives an eased stretch as its two ends and a bend, when asked', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const eased = keys<Part, Pose>(200, [
      { at: 0, delta: { x: 0 } },
      { at: 0.5, delta: { x: 10 } },
      { at: 1, delta: { x: 0 }, ease: 'ease-in' },
    ]);
    m.cue({ patch: eased });
    m.sync(0);
    const run = m.trace(0, 200, { grid: 20, bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toEqual([0, 100, 200]);
    expect(run.bends?.map((b) => b.index)).toEqual([1]);
    matches(m, run, a, 'x');
    expect(m.trace(0, 200).of(a, 'x').bends).toBeUndefined();
  });

  it('bends where eased stretches of two voices overlap, through every kind of easing', () => {
    const a = { id: 'a' };
    for (const ease of [
      'ease-out',
      'ease-in-out',
      { bezier: [0.3, -0.4, 0.6, 1.5] },
      { steps: 4 },
      (u: number) => u * u * u,
    ] as const) {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      m.cue({
        patch: keys<Part, Pose>(300, [
          { at: 0, delta: { x: 0 } },
          { at: 1, delta: { x: 30 }, ease },
        ]),
        loop: true,
      });
      m.cue({
        patch: keys<Part, Pose>(200, [
          { at: 0, delta: { x: 5 } },
          { at: 0.3, delta: { x: 5 } },
          { at: 1, delta: { x: -8 }, ease: 'ease' },
        ]),
        start: 40,
        weight: 0.5,
      });
      m.sync(10);
      const run = m.trace(10, 700, { bends: true }).of(a, 'x');
      expect(run.exact).toBe(true);
      matches(m, run, a, 'x', 0.7);
    }
  });

  it("bends a tween's stretch, and samples one with a change still to come", () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    const slide = tween<Part, Pose>('x', { from: 0, to: 40, ms: 300, ease: 'ease-in-out' });
    m.sync(0);
    m.cue({ patch: slide });
    m.sync(16);
    m.probe(a);
    slide.to(a, -20);
    m.sync(100);
    m.probe(a);
    const run = m.trace(100, 600, { bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toEqual([100, 316, 600]);
    matches(m, run, a, 'x');
    slide.to(a, 10, 200);
    expect(m.trace(100, 600, { bends: true }).of(a, 'x').exact).toBe(false);
  });

  it('bends a tween nothing has probed, with a retarget already due', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    const slide = tween<Part, Pose>('x', { from: 0, to: 40, ms: 300 });
    m.sync(0);
    m.cue({ patch: slide });
    m.sync(100);
    const first = m.trace(100, 600, { bends: true }).of(a, 'x');
    expect(first.exact).toBe(true);
    expect(first.at).toEqual([100, 300, 600]);
    matches(m, first, a, 'x');
    slide.to(a, -20, 80);
    const run = m.trace(100, 600, { bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    expect(run.at).toEqual([100, 380, 600]);
    matches(m, run, a, 'x');
  });

  it('bends a voice exactly while its rate ramps, and after', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const h = m.cue({
      patch: keys<Part, Pose>(400, [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: 40 }, ease: 'ease-in-out' },
      ]),
      loop: true,
    });
    m.sync(50);
    h.ramp(0.5, 100);
    m.sync(100);
    const during = m.trace(100, 600, { bends: true }).of(a, 'x');
    expect(during.exact).toBe(true);
    expect(during.at).toContain(150);
    matches(m, during, a, 'x');
    expect(m.trace(100, 600).of(a, 'x').exact).toBe(false);
    m.sync(160);
    const run = m.trace(160, 1200, { bends: true }).of(a, 'x');
    expect(run.exact).toBe(true);
    matches(m, run, a, 'x');
  });

  it('samples a channel a signal weighs, one with bounds, and one folded by max', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const all = keys<Part, Pose>(200, [
      { at: 0, delta: { x: 0, clip: 0, top: 0 } },
      { at: 1, delta: { x: 10, clip: 10, top: 10 } },
    ]);
    m.cue({ patch: all, weight: level(0.5) });
    m.cue({ patch: keys<Part, Pose>(200, [{ at: 0, delta: { clip: 1, top: 1 } }]) });
    m.sync(0);
    const t = m.trace(0, 100, { grid: 25 });
    for (const ch of ['x', 'clip', 'top'] as const) {
      const run = t.of(a, ch);
      expect(run.exact).toBe(false);
      expect(run.at).toEqual([0, 25, 50, 75, 100]);
    }
  });

  it('is one point for an empty window, and rest where nothing plays', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp });
    m.sync(50);
    const once = m.trace(50, 50).of(a, 'x');
    expect(once.at).toEqual([50]);
    expect(once.value[0]).toBeCloseTo(m.probe(a).x, 9);
    const still = m.trace(50, 300).of(a, 'gain');
    expect(still).toEqual({ at: [50, 300], value: [1, 1], exact: true });
  });

  it('samples a window behind the mix', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp, loop: true });
    m.sync(200);
    expect(() => m.trace(300, 100)).toThrow(RangeError);
    const run = m.trace(100, 300, { grid: 50 }).of(a, 'x');
    expect(run.exact).toBe(false);
    expect(run.at).toEqual([100, 150, 200, 250, 300]);
  });

  it('keeps a playing voice exact under a mix rate, and samples one waiting', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.cue({ patch: ramp, loop: true });
    m.rate = 2;
    m.sync(0);
    m.cue({ patch: keys<Part, Pose>(0, [{ at: 0, delta: { gain: 2 } }]), start: 300 });
    const t = m.trace(0, 400);
    expect(t.of(a, 'x').exact).toBe(true);
    expect(t.of(a, 'gain').exact).toBe(false);
  });

  it('shares its reads across subjects and moves nothing', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: ramp, loop: true });
    m.sync(10);
    const before = m.probe(a).x;
    const t = m.trace(10, 400);
    expect(t.of(a, 'x')).toEqual(t.of(b, 'x'));
    expect(t.from).toBe(10);
    expect(t.to).toBe(400);
    expect(m.now).toBe(10);
    expect(m.probe(a).x).toBe(before);
  });
});

describe('trace over random scenes', () => {
  it('agrees with project between its points wherever it says exact', () => {
    let exact = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
      const a = { id: 'a' };
      const b = { id: 'b' };
      const m = mix<Part, Pose>(K);
      m.sync(0);
      const voices = 1 + Math.floor(r() * 3);
      for (let v = 0; v < voices; v++) {
        const ch = pick(['x', 'x', 'gain'] as const);
        const n = 2 + Math.floor(r() * 4);
        const stops = Array.from({ length: n }, (_, i) => ({
          at: i === 0 ? pick([0, 0.1]) : i === n - 1 ? pick([1, 0.9]) : r(),
          delta: { [ch]: ch === 'gain' ? r() * 2 : r() * 20 - 10 },
          ease:
            r() < 0.15
              ? pick(['ease-in', 'ease-in-out', { bezier: [0.2, 0.7, 0.4, 1] }] as const)
              : undefined,
        }));
        m.cue({
          patch: keys<Part, Pose>(pick([0, 50, 120, 300]), stops, {
            delayBy: r() < 0.3 ? () => pick([20, 60]) : undefined,
          }),
          loop: pick([undefined, true, 2, 3]),
          start: pick([0, 0, 40, 170]),
          stagger: r() < 0.3 ? (s: Part) => (s.id === 'b' ? 35 : 0) : undefined,
          weight: pick([1, 1, 0.5]),
          freeze: pick([undefined, 'after', 'before', 'both'] as const),
          fade: r() < 0.2 ? { in: 30 } : undefined,
        });
      }
      const now = pick([0, 25, 90]);
      m.sync(now);
      m.probe(a);
      m.probe(b);
      const t = m.trace(now, now + 400, { grid: 7, bends: seed % 2 === 0 });
      for (const s of [a, b])
        for (const ch of ['x', 'gain'] as const) {
          const run = t.of(s, ch);
          if (run.exact) {
            exact++;
            matches(m, run, s, ch);
          } else
            for (let i = 1; i + 1 < run.at.length; i++)
              if (run.at[i - 1] !== run.at[i] && run.at[i + 1] !== run.at[i])
                expect(run.value[i]).toBeCloseTo(m.project(run.at[i] as number).probe(s)[ch], 4);
        }
    }
    // Most runs of these scenes are exact; a check that never runs proves nothing.
    expect(exact).toBeGreaterThan(80);
  });
});

describe('a point within rounding of the window', () => {
  it('is the window’s end, not a second point beside it', () => {
    const m = mix<Part, Pose>(K);
    const p: Part = { id: 'p' };
    m.cue({
      patch: keys<Part, Pose>(1500, [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: 300 } },
      ]),
      subjects: [p],
      loop: true,
    });
    m.sync(0);
    // The loop's end at 1500, and a window ending a hair past it, as a rebased clock lands.
    const run = m.trace(1450, 1500 + 1e-12).of(p, 'x');
    expect(run.at.filter((t) => Math.abs(t - 1500) < 1e-9)).toHaveLength(1);
  });

  it('does not bend the stretch before it with the bend that starts there', () => {
    const m = mix<Part, Pose>(K);
    const p: Part = { id: 'p' };
    m.cue({
      patch: keys<Part, Pose>(1500, [
        { at: 0, delta: { x: 0 } },
        { at: 0.5, delta: { x: 300 }, ease: 'ease-in-out' },
        { at: 1, delta: { x: 0 } },
      ]),
      subjects: [p],
      loop: true,
    });
    m.sync(0);
    // The next pass's eased stretch starts at 1500, a hair inside the window.
    const run = m.trace(1450, 1500 + 1e-12, { bends: true }).of(p, 'x');
    expect(run.bends).toEqual([]);
  });
});
