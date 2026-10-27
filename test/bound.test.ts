import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keys, kit, last, max, mix, mixHex, mul, patch, sum, vec } from '../src/index.js';
import type { Handle, Mix } from '../src/types.js';

type Dot = { seed: number; x: number; y: number };

const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()), color: last({ lerp: mixHex }) });
type Pose = { gain: number; dark: number; position: number[]; color: number | undefined };

const SIDE = 20;
const R = 4;

const flicker = () =>
  patch<Dot, Pose>(
    180,
    (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
    { writes: ['gain', 'dark'] },
  );

interface Way {
  lanes: boolean;
  glow?: 'fn' | 'keys' | 'color';
  moving?: boolean;
  /** Probe a window of this share of the subjects, moving each frame, instead of every one. */
  view?: number;
  pull?: boolean;
}

/** Each frame's poses of every subject read and the glow's weight for every subject. */
function play(way: Way, bounded: boolean, frames = 60): unknown[] {
  const m = mix<Dot, Pose>(K, { lanes: way.lanes });
  const dots: Dot[] = Array.from({ length: SIDE * SIDE }, (_, j) => ({
    seed: j * 0.37,
    x: j % SIDE,
    y: Math.floor(j / SIDE),
  }));
  const xy = new Float64Array(dots.length * 2);
  const write = () => {
    dots.forEach((d, j) => {
      xy[2 * j] = d.x;
      xy[2 * j + 1] = d.y;
    });
  };
  write();
  if (bounded) m.plot(dots, xy, R);
  const area = { x: 0, y: 0, r: R };
  const near = (s: Dot) => Math.max(0, 1 - Math.hypot(s.x - area.x, s.y - area.y) / R);
  m.cue({ patch: flicker(), loop: true });
  const shape =
    way.glow === 'keys'
      ? keys<Dot, Pose>(1000, [
          { at: 0, delta: { gain: 1.5 } },
          { at: 1, delta: { gain: 1.2 } },
        ])
      : way.glow === 'color'
        ? patch<Dot, Pose>(1000, () => ({ gain: 1.5, color: 0xffe08a }), {
            writes: ['gain', 'color'],
          })
        : patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });
  const glow: Handle<Dot> = m.cue({
    patch: shape,
    weight: near,
    loop: true,
    ...(bounded ? { within: area } : {}),
  });
  const out = {} as Pose;
  const cols = {
    gain: new Float64Array(dots.length),
    dark: new Float64Array(dots.length),
    position: new Float64Array(dots.length * 3),
    color: new Float64Array(dots.length),
  };
  const seen: unknown[] = [];
  for (let f = 0; f < frames; f++) {
    const a = f / 9;
    area.x = SIDE / 2 + (SIDE / 3) * Math.cos(a);
    area.y = SIDE / 2 + (SIDE / 3) * Math.sin(a);
    if (way.moving) {
      dots.forEach((d, j) => {
        d.x = (j % SIDE) + 1.5 * Math.sin(f / 5 + j);
        d.y = Math.floor(j / SIDE) + 1.5 * Math.cos(f / 7 + j);
      });
      write();
      if (bounded) m.moved();
    }
    m.sync(f * 16.7);
    const read =
      way.view === undefined
        ? dots
        : dots.filter(
            (_, j) =>
              (j - f * 37 + dots.length * 99) % dots.length < dots.length * (way.view as number),
          );
    if (way.pull) {
      m.pull(read, cols);
      seen.push(
        Array.from(cols.gain.subarray(0, read.length)),
        Array.from(cols.color.subarray(0, read.length)),
      );
    } else seen.push(read.map((d) => structuredClone(m.probe(d, out))));
    seen.push(dots.map((d) => glow.weightOf(d)));
  }
  return seen;
}

const agree = (way: Way, frames?: number) => {
  const plain = play(way, false, frames);
  const held = play(way, true, frames);
  for (let i = 0; i < plain.length; i++) expect(held[i], `read ${i}`).toStrictEqual(plain[i]);
};

describe('a bounded signal reads as the same signal unbounded, where it is 0 beyond the bound', () => {
  for (const lanes of [true, false]) {
    const on = lanes ? 'lanes on' : 'lanes off';
    it(`a fn glow, probed, ${on}`, () => agree({ lanes }));
    it(`a keys glow, probed, ${on}`, () => agree({ lanes, glow: 'keys' }));
    it(`a glow on a channel with no rest, ${on}`, () => agree({ lanes, glow: 'color' }));
    it(`subjects moving each frame, ${on}`, () => agree({ lanes, moving: true }));
    it(`a view of 40% of subjects, weights of all, ${on}`, () => agree({ lanes, view: 0.4 }));
    it(`a view of 10%, keys, ${on}`, () => agree({ lanes, view: 0.1, glow: 'keys' }));
    it(`read by pull, ${on}`, () => agree({ lanes, pull: true }));
    it(`read by pull, moving, ${on}`, () => agree({ lanes, pull: true, moving: true }));
  }
});

const grid = () =>
  Array.from({ length: SIDE * SIDE }, (_, j) => ({
    seed: j * 0.37,
    x: j % SIDE,
    y: Math.floor(j / SIDE),
  }));
const xyOf = (dots: readonly Dot[]) => new Float64Array(dots.flatMap((d) => [d.x, d.y]));
const glowPatch = () => patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] });

describe('within is refused', () => {
  const area = { x: 0, y: 0, r: 1 };
  const cue = (m: Mix<Dot, Pose>, spec: Record<string, unknown>) => () =>
    m.cue({ patch: flicker(), loop: true, within: area, ...spec });
  it('on a mix with no positions', () => {
    const m = mix<Dot, Pose>(K);
    expect(cue(m, { weight: () => 1 })).toThrow(/call mix.plot first/);
  });
  it('on a voice with no signal, and not on one naming its subjects or in a role', () => {
    const m = mix<Dot, Pose>(K);
    const dot = { seed: 0, x: 0, y: 0 };
    m.plot([dot], new Float64Array(2), 1);
    const recipe =
      /needs a signal weight; for a hard-edged disk use weight: mix\.around\(circle, \{ steps: 1, jump: 'start' \}\)/;
    expect(cue(m, {})).toThrow(recipe);
    expect(cue(m, { weight: 0.5 })).toThrow(recipe);
    expect(cue(m, { weight: () => 1, subjects: [dot] })).not.toThrow();
    expect(cue(m, { weight: () => 1, role: 'a' })).not.toThrow();
  });
  it('on a voice whose patch keeps state', () => {
    const m = mix<Dot, Pose>(K);
    m.plot([], new Float64Array(0));
    const stepped = patch<Dot, Pose, { n: number }>(100, (_ph, _s, st) => ({ gain: st.state.n }), {
      writes: ['gain'],
      state: () => ({ n: 0 }),
      step: (s) => {
        s.n++;
      },
    });
    expect(() => m.cue({ patch: stepped, weight: () => 1, loop: true, within: area })).toThrow(
      /keeping state/,
    );
  });
  it('plot with too few positions, or a cell of 0', () => {
    const m = mix<Dot, Pose>(K);
    const dots = grid();
    expect(() => m.plot(dots, new Float64Array(3))).toThrow(/two numbers a subject/);
    expect(() => m.plot(dots, xyOf(dots), 0)).toThrow(/cell/);
  });
});

describe('within keeps its signal from being read outside it', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const ways = ['alone', 'naming its subjects', 'in a role', 'in a role, apart'] as const;
  for (const lanes of [true, false])
    for (const way of ways)
      it(`calls the signal only within, and clips what it would give beyond, ${way}, lanes ${lanes ? 'on' : 'off'}`, () => {
        // The check for a clipped signal reads it outside; production makes none.
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const m = mix<Dot, Pose>(K, { lanes });
        const dots = grid();
        m.plot(dots, xyOf(dots), 2);
        const area = { x: 7, y: 9, r: 2 };
        let calls = 0;
        const wide = (s: Dot) => {
          calls++;
          return Math.max(0, 1 - Math.hypot(s.x - area.x, s.y - area.y) / 6);
        };
        const role = way.startsWith('in a role') ? { role: 'lit' } : {};
        const other = () => m.cue({ patch: glowPatch(), weight: 0.3, loop: true, role: 'lit' });
        if (way === 'in a role, apart') other();
        m.cue({ patch: flicker(), loop: true });
        if (way === 'in a role') other();
        const glow = m.cue({
          patch: glowPatch(),
          weight: wide,
          loop: true,
          within: area,
          ...role,
          ...(way === 'naming its subjects' ? { subjects: dots } : {}),
        });
        const out = {} as Pose;
        const inside = dots.filter((d) => (d.x - 7) ** 2 + (d.y - 9) ** 2 <= 4);
        for (let f = 0; f < 20; f++) {
          calls = 0;
          m.sync(f * 16.7);
          for (const d of dots) m.probe(d, out);
          // A first read of a subject may call it twice, once on each path.
          if (f > 2) expect(calls).toBe(inside.length);
        }
        for (const d of dots)
          expect(glow.weightOf(d) > 0, `${d.x},${d.y}`).toBe(inside.includes(d));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
      });
});

describe('outside production, a circle that cuts off its signal warns once', () => {
  const run = (lanes: boolean, falloff: number, frames = 40) => {
    const m = mix<Dot, Pose>(K, { lanes });
    const dots = grid();
    m.plot(dots, xyOf(dots), 2);
    const area = { x: 10, y: 10, r: 3 };
    m.cue({
      patch: glowPatch(),
      weight: (s: Dot) => Math.max(0, 1 - Math.hypot(s.x - area.x, s.y - area.y) / falloff),
      loop: true,
      within: area,
      name: 'glow',
    });
    for (let f = 0; f < frames; f++) {
      m.sync(f * 16.7);
      m.pull(dots, { gain: new Float64Array(dots.length) });
      area.x = 10 + 3 * Math.cos(f / 5);
    }
  };
  for (const lanes of [true, false]) {
    const on = lanes ? 'lanes on' : 'lanes off';
    it(`warns once, naming the voice, where the signal reaches past r, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      run(lanes, 6);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/glow's weight signal reads .* within circle/);
      warn.mockRestore();
    });
    it(`is silent where the signal falls to 0 by r, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      run(lanes, 3);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
    it(`is silent in production, ${on}`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubEnv('NODE_ENV', 'production');
      run(lanes, 6);
      vi.unstubAllEnvs();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  }
});

describe('positions hold their subjects as the mix does', () => {
  for (const lanes of [true, false])
    it(`lets go of plotted subjects the host no longer holds, lanes ${lanes ? 'on' : 'off'}`, async () => {
      setFlagsFromString('--expose_gc');
      const gc = runInNewContext('gc') as () => void;
      const m = mix<Dot, Pose>(K, { lanes });
      const area = { x: 0, y: 0, r: 2 };
      const other = { seed: 0, x: 50, y: 50 };
      const ref = (() => {
        const dots = grid();
        m.plot(dots, xyOf(dots), 2);
        m.cue({
          patch: glowPatch(),
          weight: (s: Dot) => Math.max(0, 1 - Math.hypot(s.x, s.y) / 2),
          loop: true,
          within: area,
        });
        m.sync(0);
        for (const d of dots) m.probe(d);
        return new WeakRef(dots[0] as Dot);
      })();
      for (let i = 0; i < 20 && ref.deref() !== undefined; i++) {
        await new Promise((r) => setTimeout(r, 0));
        m.sync(16.7 * (i + 1));
        m.probe(other);
        gc();
      }
      expect(ref.deref()).toBeUndefined();
    });
  for (const lanes of [true, false])
    it(`a dropped subject is outside every circle until plotted again, lanes ${lanes ? 'on' : 'off'}`, () => {
      const m = mix<string, Pose>(K, { lanes });
      const ids = ['a', 'b', 'c'];
      const xy = new Float64Array([0, 0, 1, 0, 9, 9]);
      m.plot(ids, xy, 1);
      const glow = m.cue({
        patch: glowPatch() as never,
        weight: () => 1,
        loop: true,
        within: { x: 0, y: 0, r: 2 },
      });
      const read = (t: number) => {
        m.sync(t);
        return ids.map((id) => m.probe(id).gain);
      };
      expect(read(0)).toEqual([1.5, 1.5, 1]);
      m.drop('a');
      expect(read(16)).toEqual([1, 1.5, 1]);
      expect(glow.weightOf('a')).toBe(0);
      m.plot(ids, xy, 1);
      expect(read(32)).toEqual([1.5, 1.5, 1]);
    });
});
