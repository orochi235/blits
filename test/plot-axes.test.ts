import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, mul, patch, mix as plain } from '../src/index.js';
import type { Ball, Handle, Signal } from '../src/types.js';

type Dot = { seed: number; at: number[] };
type Pose = { gain: number };

const K = kit({ gain: mul() });
const N = 400;

const flicker = () =>
  patch<Dot, Pose>(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)) }),
    { writes: ['gain'] },
  );
const glowPatch = () => patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });

/** Subject `j`'s place on `axes` axes: a line of 400, a 20 by 20 square, or a cube of side 8 or so. */
function at(j: number, axes: number): number[] {
  if (axes === 1) return [j * 0.05];
  if (axes === 2) return [j % 20, Math.floor(j / 20)];
  return [j % 8, Math.floor(j / 8) % 8, Math.floor(j / 64)];
}

/** Distance from a ball's center over `axes` axes, a field the ball leaves out reading 0. */
const dist = (ball: Ball, p: number[]): number => {
  const c = [ball.x, ball.y ?? 0, ball.z ?? 0];
  let d2 = 0;
  for (let k = 0; k < p.length; k++) d2 += ((p[k] as number) - (c[k] as number)) ** 2;
  return Math.sqrt(d2);
};

/** What `around` stands for, by hand over the subjects' own fields. */
const byHand =
  (ball: Ball): Signal<Dot> =>
  (s) => {
    const d = dist(ball, s.at);
    return ball.r > 0 && d <= ball.r ? 1 - d / ball.r : 0;
  };

interface Way {
  axes: 1 | 2 | 3;
  lanes: boolean;
  /** `around`, `within` a ball by hand, or the hand signal unbounded: what a bound must not change. */
  how: 'around' | 'within' | 'free';
  /** Moves some subjects each frame by `put`. */
  put?: boolean;
  /** Plots with no options, for the default of 2 axes. */
  bare?: boolean;
  cell?: number;
}

/** Each frame's reads and the glow's weights. */
function play(way: Way, frames = 40): unknown[] {
  const { axes } = way;
  const m = plain<Dot, Pose>(K, { lanes: way.lanes });
  const dots: Dot[] = Array.from({ length: N }, (_, j) => ({ seed: j * 0.37, at: at(j, axes) }));
  const xy = new Float64Array(dots.flatMap((d) => d.at));
  if (way.bare) m.plot(dots, xy);
  else m.plot(dots, xy, { axes, ...(way.cell === undefined ? {} : { cell: way.cell }) });
  const ball: Ball =
    axes === 1 ? { x: 5, r: 2 } : axes === 2 ? { x: 10, y: 10, r: 4 } : { x: 4, y: 4, z: 3, r: 3 };
  m.cue({ patch: flicker(), loop: true });
  const weight =
    way.how === 'around'
      ? { weight: m.around(ball) }
      : way.how === 'within'
        ? { weight: byHand(ball), within: ball }
        : { weight: byHand(ball) };
  const glow: Handle<Dot> = m.cue({ patch: glowPatch(), loop: true, ...weight });
  const seen: unknown[] = [];
  for (let f = 0; f < frames; f++) {
    ball.x = (axes === 1 ? 10 : axes === 2 ? 10 : 4) + (axes === 3 ? 2 : 4) * Math.cos(f / 9);
    if (axes > 1) ball.y = (axes === 2 ? 10 : 4) + 2 * Math.sin(f / 9);
    if (axes > 2) ball.z = 3 + 2 * Math.sin(f / 7);
    if (way.put)
      for (let k = 0; k < 6; k++) {
        const j = (f * 37 + k * 101) % N;
        const d = dots[j] as Dot;
        d.at = d.at.map((v, a) => v + Math.sin(f + j + a));
        if (axes === 1) m.put(d, d.at[0] as number);
        else if (axes === 2) m.put(d, d.at[0] as number, d.at[1] as number);
        else m.put(d, d.at[0] as number, d.at[1] as number, d.at[2] as number);
      }
    m.sync(f * 16.7);
    seen.push(dots.map((d) => m.probe(d).gain));
    seen.push(dots.map((d) => glow.weightOf(d)));
  }
  return seen;
}

const agree = (a: unknown[], b: unknown[]) => {
  for (let i = 0; i < a.length; i++) expect(a[i], `read ${i}`).toStrictEqual(b[i]);
};

describe('plot on 1, 2 and 3 axes reads as the signal by hand over the same places', () => {
  for (const axes of [1, 2, 3] as const)
    for (const lanes of [true, false])
      for (const put of [false, true]) {
        const on = `${axes} axes, lanes ${lanes ? 'on' : 'off'}${put ? ', moved by put' : ''}`;
        const free = play({ axes, lanes, how: 'free', put });
        it(`around, ${on}`, () => agree(play({ axes, lanes, how: 'around', put }), free));
        it(`within a ball, ${on}`, () => agree(play({ axes, lanes, how: 'within', put }), free));
      }
});

describe('plot options', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  for (const lanes of [true, false]) {
    const on = lanes ? 'lanes on' : 'lanes off';
    it(`takes 2 axes by default, ${on}`, () =>
      agree(
        play({ axes: 2, lanes, how: 'within', bare: true, put: true }),
        play({ axes: 2, lanes, how: 'free', put: true }),
      ));
    it(`reads the same whatever the cell, ${on}`, () => {
      const free = play({ axes: 3, lanes, how: 'free' });
      for (const cell of [0.5, 2, 9]) agree(play({ axes: 3, lanes, how: 'within', cell }), free);
    });
  }
  it('outside production, warns for a signal reaching past a ball on 1 or 3 axes, and only then', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const axes of [1, 3] as const) {
      play({ axes, lanes: true, how: 'within' });
      play({ axes, lanes: false, how: 'within' });
    }
    expect(warn).not.toHaveBeenCalled();
    for (const axes of [1, 3] as const) {
      const m = plain<Dot, Pose>(K);
      const dots: Dot[] = Array.from({ length: N }, (_, j) => ({ seed: 0, at: at(j, axes) }));
      m.plot(dots, new Float64Array(dots.flatMap((d) => d.at)), { axes });
      const ball: Ball = axes === 1 ? { x: 5, r: 1 } : { x: 4, y: 4, z: 3, r: 1.5 };
      m.cue({ patch: glowPatch(), weight: byHand({ ...ball, r: 3 }), within: ball, loop: true });
      for (let f = 0; f < 40; f++) {
        m.sync(f * 16.7);
        for (const d of dots) m.probe(d);
      }
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toMatch(/weight signal reads .* just outside/);
  });
  it('refuses an axis count other than 1, 2 or 3, too few numbers, or a cell of 0', () => {
    const m = plain<string, Pose>(K);
    for (const axes of [0, 4, 1.5, Number.NaN])
      expect(() => m.plot(['a'], new Float64Array(3), { axes: axes as 1 })).toThrow(
        /axes is 1, 2 or 3/,
      );
    expect(() => m.plot(['a', 'b'], new Float64Array(5), { axes: 3 })).toThrow(
      /three numbers a subject on 3 axes: 2 subjects need 6, not 5/,
    );
    expect(() => m.plot(['a', 'b'], new Float64Array(1), { axes: 1 })).toThrow(
      /one number a subject/,
    );
    expect(() => m.plot(['a'], new Float64Array(2), { cell: 0 })).toThrow(/cell/);
  });
  it('takes the old shape, a cell as the third argument, with one warning a mix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reads = () => {
      const m = plain<string, Pose>(K);
      const xy = new Float64Array([0, 0, 5, 5]);
      m.plot(['a', 'b'], xy, 2);
      m.plot(['a', 'b'], xy, 2);
      const glow = m.cue({
        patch: glowPatch() as never,
        weight: m.around({ x: 0, y: 0, r: 2 }),
        loop: true,
      });
      m.sync(0);
      m.probe('a');
      m.probe('b');
      return [glow.weightOf('a'), glow.weightOf('b')];
    };
    expect(reads()).toEqual([1, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/plot\(subjects, xy, \{ cell \}\)/);
    reads();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(() => plain<string, Pose>(K).plot(['a'], new Float64Array(2), 0)).toThrow(/cell/);
  });
});

describe('put on 1, 2 and 3 axes', () => {
  it('writes as many numbers as plot gave axes, an axis left out reading 0', () => {
    const m = plain<string, Pose>(K);
    const one = new Float64Array(2);
    m.plot(['a', 'b'], one, { axes: 1 });
    m.put('b', 4);
    expect(Array.from(one)).toEqual([0, 4]);
    const three = new Float64Array(6);
    m.plot(['a', 'b'], three, { axes: 3 });
    m.put('b', 1, 2, 3);
    m.put('a', 7);
    expect(Array.from(three)).toEqual([7, 0, 0, 1, 2, 3]);
    expect(() => m.put('c', 0)).toThrow(/place or plot it first/);
  });
  it('gives a placed subject a place on 2 axes with no plot', () => {
    const m = plain<string, Pose>(K);
    m.place('a');
    m.place('b');
    m.put('a', 1);
    m.put('b', 0, 3);
    const glow = m.cue({
      patch: glowPatch() as never,
      weight: m.around({ x: 0, r: 2 }),
      loop: true,
    });
    m.sync(0);
    m.probe('a');
    m.probe('b');
    expect([glow.weightOf('a'), glow.weightOf('b')]).toEqual([0.5, 0]);
  });
  it('reads a ball by field: one with no z on 3 axes is at z 0, and z on 1 axis is not read', () => {
    const m = plain<string, Pose>(K);
    m.plot(['a', 'b'], new Float64Array([0, 0, 1, 0, 0, 0]), { axes: 3 });
    const flat = m.cue({
      patch: glowPatch() as never,
      weight: m.around({ x: 0, y: 0, r: 2 }),
      loop: true,
    });
    const line = plain<string, Pose>(K);
    line.plot(['a'], new Float64Array([1]), { axes: 1 });
    const far = line.cue({
      patch: glowPatch() as never,
      weight: line.around({ x: 0, y: 9, z: 9, r: 2 }),
      loop: true,
    });
    m.sync(0);
    line.sync(0);
    m.probe('a');
    m.probe('b');
    line.probe('a');
    expect([flat.weightOf('a'), flat.weightOf('b'), far.weightOf('a')]).toEqual([0.5, 1, 0.5]);
  });
});
