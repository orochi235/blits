import { describe, expect, it, vi } from 'vitest';
import { kit, mul, sum, vec } from '../src/channels.js';
import { type Mixer, mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { patch } from '../src/patch.js';

interface Pose {
  gain: number;
  position: number[];
}
const K = kit<Pose>({ gain: mul(), position: vec(2, sum()) });
type Part = { id: number };

/** A fn keeping state, which no lane runs, on `key` for `ms`. */
const stateful = (ms: number, key: 'gain' | 'position') =>
  patch<Part, Pose, { last: number }>(
    ms,
    (ph, _s, c) => {
      const st = c.state;
      st.last = 0.5 * st.last + ph;
      return key === 'gain' ? { gain: 1 - 0.1 * st.last } : { position: [st.last, -st.last] };
    },
    { writes: [key], state: () => ({ last: 0 }) },
  );

/** One tween a subject on `position`, in a mix with lanes on or off. */
function crowd(lanes: boolean, parts: readonly Part[]) {
  const m = mix<Part, Pose>(K, { lanes });
  for (const p of parts)
    m.cue({
      patch: tween('position', { from: [0, 0], to: [p.id, 1], ms: 1e6 }),
      subjects: [p],
    });
  return m;
}

function read(m: ReturnType<typeof crowd>, list: readonly Part[]) {
  const gain = new Float64Array(list.length);
  const position = new Float64Array(list.length * 2);
  m.pull(list, { gain, position });
  return { gain: [...gain], position: [...position] };
}

describe('pull while a voice plays off lanes', () => {
  for (const key of ['gain', 'position'] as const)
    it(`reads what lanes off reads, the voice on ${key}`, () => {
      const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
      const on = crowd(true, parts);
      const off = crowd(false, parts);
      const both = (f: (m: ReturnType<typeof crowd>) => void) => {
        f(on);
        f(off);
      };
      let list = parts.slice();
      let t = 0;
      const late = { id: 99 };
      for (let f = 0; f < 40; f++) {
        t += 16;
        // Cued over a subject not yet seen, which is numbered while the voice plays.
        if (f === 2)
          both((m) => m.cue({ patch: stateful(200, key), subjects: [parts[3] as Part, late] }));
        if (f === 5) list.push(late);
        if (f === 8)
          both((m) => m.cue({ patch: stateful(50, key), subjects: [parts[30] as Part] }));
        // Swap-remove, which renumbers the last subject into the freed number.
        if (f === 12) {
          const i = list.indexOf(parts[10] as Part);
          list[i] = list[list.length - 1] as Part;
          list.pop();
          both((m) => m.drop(parts[10] as Part));
        }
        if (f === 20)
          both((m) => m.cue({ patch: stateful(100, key), subjects: [list[0] as Part] }));
        if (f === 30) list = list.slice().reverse();
        both((m) => m.sync(t));
        expect(read(on, list), `frame ${f}`).toEqual(read(off, list));
      }
    });

  it('folds only the subjects the voice reaches on the general path', () => {
    const parts = Array.from({ length: 64 }, (_, id) => ({ id }));
    const m = crowd(true, parts);
    let t = 0;
    for (let f = 0; f < 4; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
    }
    m.cue({ patch: stateful(1000, 'gain'), subjects: [parts[7] as Part] });
    t += 16;
    m.sync(t);
    read(m, parts);
    const fold = vi.spyOn(m as unknown as Mixer<Part, Pose>, 'foldWith');
    for (let f = 0; f < 3; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
    }
    expect(fold.mock.calls.map((c) => (c[0] as Part).id)).toEqual([7, 7, 7]);
  });
});

describe('atRest while a voice plays off lanes', () => {
  it('answers what lanes off answers, probed or pulled', () => {
    const parts = Array.from({ length: 24 }, (_, id) => ({ id }));
    const on = crowd(true, parts);
    const off = crowd(false, parts);
    const both = (f: (m: ReturnType<typeof crowd>) => void) => {
      f(on);
      f(off);
    };
    // Tweens that land, so some subjects rest and some do not.
    for (const p of parts.slice(0, 8))
      both((m) =>
        m.cue({
          patch: tween('position', { from: [p.id, 0], to: [0, 0], ms: 80 }),
          subjects: [p],
        }),
      );
    let t = 0;
    for (let f = 0; f < 30; f++) {
      t += 16;
      if (f === 2)
        both((m) => m.cue({ patch: stateful(200, 'gain'), subjects: [parts[3] as Part] }));
      if (f === 9)
        both((m) => m.cue({ patch: stateful(60, 'position'), subjects: [parts[5] as Part] }));
      both((m) => m.sync(t));
      if (f % 2 === 0) read(on, parts);
      else for (const p of parts.slice(0, 12)) on.probe(p);
      const rest = (m: ReturnType<typeof crowd>) => parts.map((p) => m.atRest(p));
      expect(rest(on), `frame ${f}`).toEqual(rest(off));
    }
  });

  it('folds only the subjects the voice reaches', () => {
    const parts = Array.from({ length: 64 }, (_, id) => ({ id }));
    const m = crowd(true, parts);
    let t = 0;
    for (let f = 0; f < 4; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
    }
    m.cue({ patch: stateful(1000, 'gain'), subjects: [parts[7] as Part] });
    t += 16;
    m.sync(t);
    read(m, parts);
    const fold = vi.spyOn(m as unknown as Mixer<Part, Pose>, 'foldWith');
    for (let f = 0; f < 2; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
      for (const p of parts) m.atRest(p);
    }
    expect(fold.mock.calls.map((c) => (c[0] as Part).id)).toEqual([7, 7, 7, 7]);
  });
});

type Dot = { id: number; x: number; y: number };
const SIDE = 12;

const grid = (): Dot[] =>
  Array.from({ length: SIDE * SIDE }, (_, id) => ({ id, x: id % SIDE, y: Math.floor(id / SIDE) }));

/** A glow keeping state with no step, which no lane runs, on `gain`. */
const glow = (ms: number) =>
  patch<Dot, Pose, { n: number }>(
    ms,
    (ph, _d, c) => {
      c.state.n += ph;
      return { gain: 1 + 0.1 * c.state.n };
    },
    { writes: ['gain'], state: () => ({ n: 0 }) },
  );

interface BoundWay {
  /** The bound is the `around` signal's own ball, or a host's finder beside a signal of its own. */
  by: 'ball' | 'finder';
  pull: boolean;
  /** Read a window of this share of the dots, moving each frame, instead of every one. */
  view?: number;
  moving?: boolean;
}

/**
 * Each frame of a crowd of tweens on `position` and a glow bounded to a ball circling the grid,
 * which plays out and is cued again: what was read, every dot's glow weight, and every 4th frame
 * whether each dot rests.
 */
function glowing(lanes: boolean, way: BoundWay): unknown[] {
  const m = mix<Dot, Pose>(K, { lanes });
  const dots = grid();
  const xy = new Float64Array(dots.flatMap((d) => [d.x, d.y]));
  m.plot(dots, xy, { cell: 2 });
  for (const d of dots)
    m.cue({
      patch: tween('position', { from: [0, 0], to: [d.id, 1], ms: d.id % 3 === 0 ? 300 : 1e6 }),
      subjects: [d],
    });
  const ball = { x: 0, y: 0, r: 2.5 };
  const finder = {
    find(out: Int32Array) {
      let n = 0;
      dots.forEach((d, j) => {
        if (Math.hypot(d.x - ball.x, d.y - ball.y) <= ball.r) out[n++] = j;
      });
      return n;
    },
  };
  const cueGlow = () =>
    way.by === 'ball'
      ? m.cue({ patch: glow(400), weight: m.around(ball) })
      : m.cue({
          patch: glow(400),
          weight: (d: Dot) => Math.max(0, 1 - Math.hypot(d.x - ball.x, d.y - ball.y) / ball.r),
          within: finder,
        });
  let handle = cueGlow();
  const gain = new Float64Array(dots.length);
  const position = new Float64Array(dots.length * 2);
  const out = {} as Pose;
  const seen: unknown[] = [];
  for (let f = 0; f < 50; f++) {
    ball.x = SIDE / 2 + (SIDE / 3) * Math.cos(f / 4);
    ball.y = SIDE / 2 + (SIDE / 3) * Math.sin(f / 4);
    if (way.moving && f % 3 === 0) {
      dots.forEach((d, j) => {
        d.x = (j % SIDE) + Math.sin(f / 5 + j);
        d.y = Math.floor(j / SIDE) + Math.cos(f / 7 + j);
        xy[2 * j] = d.x;
        xy[2 * j + 1] = d.y;
      });
      m.moved();
    }
    if (f === 30) handle = cueGlow();
    m.sync(f * 16.7);
    const view = way.view;
    const read =
      view === undefined
        ? dots
        : dots.filter((_, j) => (j - f * 37 + dots.length * 99) % dots.length < dots.length * view);
    if (way.pull) {
      m.pull(read, { gain, position });
      seen.push(
        Array.from(gain.subarray(0, read.length)),
        Array.from(position.subarray(0, 2 * read.length)),
      );
    } else seen.push(read.map((d) => structuredClone(m.probe(d, out))));
    seen.push(dots.map((d) => handle.weightOf(d)));
    if (f % 4 === 0) seen.push(dots.map((d) => m.atRest(d)));
  }
  return seen;
}

describe('a bounded voice naming no subjects off lanes', () => {
  const ways: [string, BoundWay][] = [
    ['its ball, read by pull', { by: 'ball', pull: true }],
    ['its ball, probed', { by: 'ball', pull: false }],
    ['its ball, a view of 40%, read by pull', { by: 'ball', pull: true, view: 0.4 }],
    [
      'its ball, a view of 30%, probed, moving',
      { by: 'ball', pull: false, view: 0.3, moving: true },
    ],
    ['a finder, read by pull, moving', { by: 'finder', pull: true, moving: true }],
    ['a finder, a view of 40%, probed', { by: 'finder', pull: false, view: 0.4 }],
  ];
  for (const [name, way] of ways)
    it(`reads what lanes off reads: ${name}`, () => {
      const on = glowing(true, way);
      const off = glowing(false, way);
      expect(on.length).toBe(off.length);
      for (let i = 0; i < off.length; i++) expect(on[i], `read ${i}`).toStrictEqual(off[i]);
    });

  it('folds only the subjects within its ball, and those it left holding a weight', () => {
    const m = mix<Dot, Pose>(K, { lanes: true });
    const dots = grid();
    m.plot(dots, new Float64Array(dots.flatMap((d) => [d.x, d.y])), { cell: 2 });
    for (const d of dots)
      m.cue({ patch: tween('position', { from: [0, 0], to: [d.id, 1], ms: 1e6 }), subjects: [d] });
    const cols = {
      gain: new Float64Array(dots.length),
      position: new Float64Array(dots.length * 2),
    };
    let t = 0;
    const frame = () => {
      t += 16;
      m.sync(t);
      m.pull(dots, cols);
    };
    for (let f = 0; f < 4; f++) frame();
    const ball = { x: 3, y: 3, r: 1 };
    const handle = m.cue({ patch: glow(1e6), weight: m.around(ball) });
    frame();
    const near = () =>
      dots.filter((d) => Math.hypot(d.x - ball.x, d.y - ball.y) <= ball.r).map((d) => d.id);
    const fold = vi.spyOn(m as unknown as Mixer<Dot, Pose>, 'foldWith');
    const folded = () => fold.mock.calls.map((c) => (c[0] as Dot).id).sort((a, b) => a - b);
    frame();
    frame();
    const within = near();
    expect(within.length).toBeGreaterThan(0);
    expect(folded()).toEqual([...within, ...within].sort((a, b) => a - b));
    // One the ball's edge gave 0 has nothing for a read outside to set back.
    const held = within.filter((id) => handle.weightOf(dots[id] as Dot) !== 0);
    expect(held.length).toBeGreaterThan(0);
    expect(held.length).toBeLessThan(within.length);
    fold.mockClear();
    ball.x = 8;
    frame();
    expect(folded()).toEqual([...new Set([...held, ...near()])].sort((a, b) => a - b));
    fold.mockClear();
    frame();
    expect(folded()).toEqual(near());
  });
});
