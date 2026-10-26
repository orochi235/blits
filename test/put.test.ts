import { describe, expect, it } from 'vitest';
import { kit, mul, patch, mix as plain } from '../src/index.js';
import type { Handle, Signal } from '../src/types.js';

type Dot = { seed: number; x: number; y: number };
type Pose = { gain: number };

const K = kit({ gain: mul() });
const SIDE = 20;

const flicker = () =>
  patch<Dot, Pose>(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)) }),
    {
      writes: ['gain'],
    },
  );
const glowPatch = () => patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });

/** Where subject `j` is at frame `f`: most never move, a few wander, some far off the grid. */
function moves(f: number, n: number): [number, number, number][] {
  // Every 10th frame moves many at once, past what keeps the grid as built.
  const count = f % 10 === 9 ? 60 : 4;
  const out: [number, number, number][] = [];
  for (let k = 0; k < count; k++) {
    const j = (f * 37 + k * 101) % n;
    const far = (f + k) % 7 === 0;
    out.push([
      j,
      far ? -6 + (f % 3) * 20 : (j % SIDE) + 1.5 * Math.sin(f / 5 + j),
      far ? 30 - (f % 4) : Math.floor(j / SIDE) + 1.5 * Math.cos(f / 7 + j),
    ]);
  }
  return out;
}

interface Way {
  lanes: boolean;
  near?: boolean;
  pull?: boolean;
}

/** Each frame's reads and the glow's weights, the movers given by `put` or by `moved`. */
function play(way: Way, byPut: boolean, frames = 60): unknown[] {
  const m = plain<Dot, Pose>(K, { lanes: way.lanes });
  const dots: Dot[] = Array.from({ length: SIDE * SIDE }, (_, j) => ({
    seed: j * 0.37,
    x: j % SIDE,
    y: Math.floor(j / SIDE),
  }));
  const xy = new Float64Array(dots.flatMap((d) => [d.x, d.y]));
  m.plot(dots, xy, 2);
  const area = { x: 0, y: 0, r: 4 };
  const close: Signal<Dot> = (s) => Math.max(0, 1 - Math.hypot(s.x - area.x, s.y - area.y) / 4);
  m.cue({ patch: flicker(), loop: true });
  const glow: Handle<Dot> = m.cue({
    patch: glowPatch(),
    loop: true,
    ...(way.near ? { weight: m.near(area) } : { weight: close, within: area }),
  });
  const cols = { gain: new Float64Array(dots.length) };
  const seen: unknown[] = [];
  for (let f = 0; f < frames; f++) {
    area.x = SIDE / 2 + (SIDE / 3) * Math.cos(f / 9);
    area.y = SIDE / 2 + (SIDE / 3) * Math.sin(f / 9);
    for (const [j, x, y] of moves(f, dots.length)) {
      const d = dots[j] as Dot;
      d.x = x;
      d.y = y;
      if (byPut) m.put(d, x, y);
      else {
        xy[2 * j] = x;
        xy[2 * j + 1] = y;
      }
    }
    if (!byPut) m.moved();
    m.sync(f * 16.7);
    if (way.pull) {
      m.pull(dots, cols);
      seen.push(Array.from(cols.gain));
    } else seen.push(dots.map((d) => m.probe(d).gain));
    seen.push(dots.map((d) => glow.weightOf(d)));
  }
  seen.push(Array.from(xy));
  return seen;
}

const agree = (way: Way) => {
  const moved = play(way, false);
  const put = play(way, true);
  for (let i = 0; i < moved.length; i++) expect(put[i], `read ${i}`).toStrictEqual(moved[i]);
};

describe('put reads as writing the plotted array and calling moved', () => {
  for (const lanes of [true, false]) {
    const on = lanes ? 'lanes on' : 'lanes off';
    it(`within, probed, ${on}`, () => agree({ lanes }));
    it(`within, read by pull, ${on}`, () => agree({ lanes, pull: true }));
    it(`near, probed, ${on}`, () => agree({ lanes, near: true }));
    it(`near, read by pull, ${on}`, () => agree({ lanes, near: true, pull: true }));
  }
});

describe('put', () => {
  it('writes into the array plot was given, and mixes with moved', () => {
    const m = plain<string, Pose>(K);
    const xy = new Float64Array([0, 0, 5, 5]);
    m.plot(['a', 'b'], xy, 1);
    const glow = m.cue({
      patch: glowPatch() as never,
      weight: m.near({ x: 0, y: 0, r: 2 }),
      loop: true,
    });
    m.sync(0);
    m.probe('a');
    m.probe('b');
    expect([glow.weightOf('a'), glow.weightOf('b')]).toEqual([1, 0]);
    m.put('b', 1, 0);
    expect(Array.from(xy)).toEqual([0, 0, 1, 0]);
    xy[0] = 9;
    m.moved();
    m.sync(16);
    m.probe('a');
    m.probe('b');
    expect([glow.weightOf('a'), glow.weightOf('b')]).toEqual([0, 0.5]);
  });
  it('refuses a subject plot was not given, or one dropped since', () => {
    const m = plain<string, Pose>(K);
    expect(() => m.put('a', 0, 0)).toThrow(/plot it first/);
    m.plot(['a'], new Float64Array(2));
    m.drop('a');
    expect(() => m.put('a', 0, 0)).toThrow(/plot it first/);
  });
});
