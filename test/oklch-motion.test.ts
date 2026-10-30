import { describe, expect, it } from 'vitest';
import { kit } from '../src/channels.js';
import { color, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import type { Channel } from '../src/types.js';

interface Pose {
  tint: number[];
}
interface Part {
  id: string;
}
const RED = oklab(0xff0000);
const CYAN = oklab(0x00ffff);
const BLUE = oklab(0x0000ff);

/** A pose's chroma and hue, its color divided out of its coverage. */
const lch = (c: readonly number[]) => {
  const w = c[3] as number;
  const a = (c[1] as number) / w;
  const b = (c[2] as number) / w;
  return { L: (c[0] as number) / w, C: Math.hypot(a, b), h: Math.atan2(b, a) };
};
const C_RED = lch(RED).C;
const C_CYAN = lch(CYAN).C;

/** An OKLab velocity at `c` that turns its hue at `dh` radians a second, chroma and lightness held. */
const turning = (c: readonly number[], dh: number): number[] => {
  const { C, h } = lch(c);
  return [0, -C * dh * Math.sin(h), C * dh * Math.cos(h), 0];
};

const made = (tint: Channel<number[]>, lanes: boolean) =>
  mix<Part, Pose>(kit<Pose>({ tint }), { lanes });

describe("a tween on color({ path: 'hue' })", () => {
  it('keeps chroma at its midpoint, as the channel lerp does, on lanes and off', () => {
    for (const lanes of [false, true]) {
      const round = color({ path: 'hue' });
      const m = made(round, lanes);
      m.cue({
        patch: tween<Part, Pose, number[]>('tint', {
          from: RED,
          to: CYAN,
          ms: 1000,
          ease: 'linear',
        }),
      });
      const a = { id: 'a' };
      m.sync(0);
      m.probe(a);
      m.sync(500);
      const mid = m.probe(a).tint;
      expect(lch(mid).C, `lanes ${lanes}`).toBeCloseTo((C_RED + C_CYAN) / 2, 9);
      const want = round.lerp(RED, CYAN, 0.5);
      for (let i = 0; i < 4; i++) expect(mid[i]).toBeCloseTo(want[i] as number, 12);
      m.sync(1000);
      expect(m.probe(a).tint).toEqual(CYAN);
    }
  });

  it('fades coverage alongside, a color with none taking the other end’s', () => {
    const round = color({ path: 'hue' });
    const m = made(round, false);
    m.cue({
      patch: tween<Part, Pose, number[]>('tint', {
        from: [0, 0, 0, 0],
        to: BLUE,
        ms: 100,
        ease: 'linear',
      }),
    });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(50);
    const half = m.probe(a).tint;
    expect(half[3]).toBeCloseTo(0.5, 12);
    expect(lch(half).C).toBeCloseTo(lch(BLUE).C, 9);
  });

  it('leaves the default OKLab channel straight across each axis', () => {
    const m = made(color(), false);
    m.cue({
      patch: tween<Part, Pose, number[]>('tint', { from: RED, to: CYAN, ms: 1000, ease: 'linear' }),
    });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(500);
    const mid = m.probe(a).tint;
    for (let i = 0; i < 4; i++)
      expect(mid[i]).toBe((CYAN[i] as number) + ((RED[i] as number) - (CYAN[i] as number)) * 0.5);
  });
});

describe("a spring on color({ path: 'hue' })", () => {
  it('goes round the hue rather than through gray', () => {
    for (const lanes of [false, true]) {
      const m = made(color({ path: 'hue' }), lanes);
      m.cue({ patch: spring<Part, Pose, number[]>('tint', { from: RED, to: CYAN, damping: 40 }) });
      const a = { id: 'a' };
      let least = Number.POSITIVE_INFINITY;
      for (let t = 0; t <= 2000; t += 10) {
        m.sync(t);
        least = Math.min(least, lch(m.probe(a).tint).C);
      }
      expect(least, `lanes ${lanes}`).toBeGreaterThan(Math.min(C_RED, C_CYAN) - 1e-6);
      for (let i = 0; i < 4; i++) expect(m.probe(a).tint[i]).toBeCloseTo(CYAN[i] as number, 4);
    }
  });

  it('carries position and velocity through a retarget mid-flight', () => {
    const s = spring<Part, Pose, number[]>('tint', { from: RED, to: CYAN, settle: 0 });
    const m = made(color({ path: 'hue' }), false);
    m.cue({ patch: s });
    const a = { id: 'a' };
    for (let t = 0; t <= 100; t += 16) {
      m.sync(t);
      m.probe(a);
    }
    m.sync(100);
    m.probe(a);
    const before = s.read(a) as { value: number[]; velocity: number[] };
    expect(Math.hypot(...before.velocity)).toBeGreaterThan(0.1);
    s.to(a, BLUE);
    m.sync(100.0001);
    m.probe(a);
    const after = s.read(a) as { value: number[]; velocity: number[] };
    for (let i = 0; i < 4; i++) {
      expect(after.value[i]).toBeCloseTo(before.value[i] as number, 4);
      expect(after.velocity[i]).toBeCloseTo(before.velocity[i] as number, 2);
    }
    m.sync(4000);
    for (let i = 0; i < 4; i++) expect(m.probe(a).tint[i]).toBeCloseTo(BLUE[i] as number, 4);
  });
});

describe("a glide on color({ path: 'hue' })", () => {
  it('coasts round the hue at the chroma it started at, and a push carries on from there', () => {
    for (const lanes of [false, true]) {
      const g = glide<Part, Pose, number[]>('tint', {
        from: RED,
        velocity: turning(RED, 4),
        ms: 250,
        settle: 0,
      });
      const m = made(color({ path: 'hue' }), lanes);
      m.cue({ patch: g });
      const a = { id: 'a' };
      for (let t = 0; t <= 100; t += 10) {
        m.sync(t);
        expect(lch(m.probe(a).tint).C, `lanes ${lanes} t=${t}`).toBeCloseTo(C_RED, 9);
      }
      const there = m.probe(a).tint;
      g.push(a, turning(there, -2));
      m.sync(100.0001);
      const next = m.probe(a).tint;
      for (let i = 0; i < 4; i++) expect(next[i]).toBeCloseTo(there[i] as number, 4);
      m.sync(5000);
      const rest = lch(m.probe(a).tint);
      expect(rest.C).toBeCloseTo(C_RED, 9);
      expect(rest.h).toBeCloseTo(lch(there).h - 2 * 0.25, 6);
    }
  });

  it('refuses bounds, which are boxes on the OKLab axes', () => {
    const g = glide<Part, Pose, number[]>('tint', {
      from: RED,
      bounds: [
        [0, -1, -1, 0],
        [1, 1, 1, 1],
      ],
    });
    const m = made(color({ path: 'hue' }), false);
    expect(() => m.cue({ patch: g })).toThrow(/bounds/);
  });
});
