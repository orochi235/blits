import { afterEach, describe, expect, it, vi } from 'vitest';
import { curve, kit, last, mixHex, mul, patch, mix as plain } from '../src/index.js';
import type { Circle, Easing, Handle, Signal } from '../src/types.js';

type Dot = { seed: number; x: number; y: number };
type Pose = { gain: number; color: number | undefined };

const K = kit({ gain: mul(), color: last({ lerp: mixHex }) });
const SIDE = 20;

const flicker = () =>
  patch<Dot, Pose>(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)) }),
    {
      writes: ['gain'],
    },
  );
const glowPatch = () =>
  patch<Dot, Pose>(1000, () => ({ gain: 1.5, color: 0xffe08a }), { writes: ['gain', 'color'] });

/** What `around` stands for, written by hand over the subjects' own fields. */
const byHand =
  (area: Circle, ease: Easing = 'linear'): Signal<Dot> =>
  (s) => {
    const shape = curve(ease);
    const dx = s.x - area.x;
    const dy = s.y - area.y;
    const d2 = dx * dx + dy * dy;
    return area.r > 0 && d2 <= area.r * area.r ? shape(1 - Math.sqrt(d2) / area.r) : 0;
  };

interface Way {
  lanes: boolean;
  ease?: Easing;
  moving?: boolean;
  pull?: boolean;
  /** Names its subjects, which a bound refuses: `around` then plays unbounded. */
  named?: boolean;
}

/** Each frame's reads, and the glow's weight for every subject, weighted by `around` or by hand. */
function play(way: Way, mine: boolean, frames = 50): unknown[] {
  const m = plain<Dot, Pose>(K, { lanes: way.lanes });
  const dots: Dot[] = Array.from({ length: SIDE * SIDE }, (_, j) => ({
    seed: j * 0.37,
    x: j % SIDE,
    y: Math.floor(j / SIDE),
  }));
  const xy = new Float64Array(dots.length * 2);
  const write = () =>
    dots.forEach((d, j) => {
      xy[2 * j] = d.x;
      xy[2 * j + 1] = d.y;
    });
  write();
  m.plot(dots, xy, 3);
  const area = { x: 0, y: 0, r: 4 };
  m.cue({ patch: flicker(), loop: true });
  const glow: Handle<Dot> = m.cue({
    patch: glowPatch(),
    loop: true,
    ...(mine
      ? { weight: m.around(area, way.ease === undefined ? {} : { ease: way.ease }) }
      : { weight: byHand(area, way.ease), ...(way.named ? {} : { within: area }) }),
    ...(way.named ? { subjects: dots } : {}),
  });
  const cols = { gain: new Float64Array(dots.length), color: new Float64Array(dots.length) };
  const seen: unknown[] = [];
  for (let f = 0; f < frames; f++) {
    area.x = SIDE / 2 + (SIDE / 3) * Math.cos(f / 9);
    area.y = SIDE / 2 + (SIDE / 3) * Math.sin(f / 9);
    area.r = 4 + 2 * Math.sin(f / 13);
    if (way.moving) {
      dots.forEach((d, j) => {
        d.x = (j % SIDE) + 1.5 * Math.sin(f / 5 + j);
        d.y = Math.floor(j / SIDE) + 1.5 * Math.cos(f / 7 + j);
      });
      write();
      m.moved();
    }
    m.sync(f * 16.7);
    if (way.pull) {
      m.pull(dots, cols);
      seen.push(Array.from(cols.gain), Array.from(cols.color));
    } else seen.push(dots.map((d) => structuredClone(m.probe(d))));
    seen.push(dots.map((d) => glow.weightOf(d)));
  }
  return seen;
}

const agree = (way: Way) => {
  const hand = play(way, false);
  const mine = play(way, true);
  for (let i = 0; i < hand.length; i++) expect(mine[i], `read ${i}`).toStrictEqual(hand[i]);
};

describe('around reads as the same signal written by hand and cued within its circle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  for (const lanes of [true, false]) {
    const on = lanes ? 'lanes on' : 'lanes off';
    it(`linear, probed, ${on}`, () => agree({ lanes }));
    it(`linear, read by pull, ${on}`, () => agree({ lanes, pull: true }));
    it(`ease-out, subjects moving, ${on}`, () => agree({ lanes, ease: 'ease-out', moving: true }));
    it(`a bezier, read by pull, moving, ${on}`, () =>
      agree({ lanes, ease: { bezier: [0.3, 0, 0.2, 1] }, pull: true, moving: true }));
    it(`steps, which leave a hard edge, ${on}`, () =>
      agree({ lanes, ease: { steps: 1, jump: 'start' } }));
    it(`unbounded on a voice naming its subjects, ${on}`, () => agree({ lanes, named: true }));
    it(`never warns that its circle clips it, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      play({ lanes, ease: { steps: 1, jump: 'start' }, pull: true }, true);
      expect(warn).not.toHaveBeenCalled();
    });
  }
});

describe('around', () => {
  it('reads 0 for a subject with no position, and before any plot', () => {
    const m = plain<Dot, Pose>(K);
    const area = { x: 0, y: 0, r: 2 };
    const glow = m.around(area);
    const a = { seed: 0, x: 0, y: 0 };
    const setting = {} as never;
    expect(glow(a, setting)).toBe(0);
    m.plot([a], new Float64Array([0.5, 0]));
    expect(glow(a, setting)).toBe(0.75);
    expect(glow({ seed: 1, x: 0, y: 0 }, setting)).toBe(0);
    const h = m.cue({ patch: glowPatch(), weight: glow, loop: true });
    m.sync(0);
    m.probe(a);
    expect(h.weightOf(a)).toBe(0.75);
  });
  it('refuses a circle that is not one', () => {
    const m = plain<Dot, Pose>(K);
    expect(() => m.around(null as never)).toThrow(/around takes a circle/);
  });
});
