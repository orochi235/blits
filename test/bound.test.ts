import { describe, expect, it } from 'vitest';
import { bound, moved, place } from '../src/bound.js';
import type { VoiceHandle } from '../src/handle.js';
import { keys, kit, last, max, mix, mixHex, mul, patch, sum, vec } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
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
  /** The frame the bound is put on, the glow playing unbounded before it. */
  from?: number;
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
  if (bounded) place(m as unknown as Mixer<Dot, Pose>, dots, xy, R);
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
  const glow: Handle<Dot> = m.cue({ patch: shape, weight: near, loop: true });
  const from = way.from ?? 0;
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
      if (bounded) moved(m as unknown as Mixer<Dot, Pose>);
    }
    if (bounded && f === from)
      bound(m as unknown as Mixer<Dot, Pose>, glow as unknown as VoiceHandle<Dot, Pose>, area);
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
    it(`bounded from frame 20, after playing unbounded, ${on}`, () => agree({ lanes, from: 20 }));
    it(`bounded from frame 20, a view, ${on}`, () => agree({ lanes, from: 20, view: 0.4 }));
  }
});

describe('a bound is refused', () => {
  const cue = (m: Mix<Dot, Pose>, spec: Record<string, unknown>) =>
    m.cue({ patch: flicker(), loop: true, ...spec }) as unknown as VoiceHandle<Dot, Pose>;
  const area = { x: 0, y: 0, r: 1 };
  it('on a mix with no positions', () => {
    const m = mix<Dot, Pose>(K);
    const h = cue(m, { weight: () => 1 });
    expect(() => bound(m as unknown as Mixer<Dot, Pose>, h, area)).toThrow(/no positions/);
  });
  it('on a voice with no signal, or one naming its subjects', () => {
    const m = mix<Dot, Pose>(K);
    const dot = { seed: 0, x: 0, y: 0 };
    place(m as unknown as Mixer<Dot, Pose>, [dot], new Float64Array(2), 1);
    expect(() => bound(m as unknown as Mixer<Dot, Pose>, cue(m, {}), area)).toThrow(/no signal/);
    expect(() =>
      bound(m as unknown as Mixer<Dot, Pose>, cue(m, { weight: () => 1, subjects: [dot] }), area),
    ).toThrow(/not on this voice/);
  });
  it('on a voice whose patch keeps state', () => {
    const m = mix<Dot, Pose>(K);
    place(m as unknown as Mixer<Dot, Pose>, [], new Float64Array(0), 1);
    const stepped = patch<Dot, Pose, { n: number }>(100, (_ph, _s, st) => ({ gain: st.state.n }), {
      writes: ['gain'],
      state: () => ({ n: 0 }),
      step: (s) => {
        s.n++;
      },
    });
    const h = m.cue({ patch: stepped, weight: () => 1, loop: true });
    expect(() =>
      bound(m as unknown as Mixer<Dot, Pose>, h as unknown as VoiceHandle<Dot, Pose>, area),
    ).toThrow(/not on this voice/);
  });
});

describe('a bound keeps its signal from being read outside it', () => {
  for (const lanes of [true, false])
    it(`calls the signal only within, and clips what it would give beyond, lanes ${lanes ? 'on' : 'off'}`, () => {
      const m = mix<Dot, Pose>(K, { lanes });
      const dots: Dot[] = Array.from({ length: SIDE * SIDE }, (_, j) => ({
        seed: j * 0.37,
        x: j % SIDE,
        y: Math.floor(j / SIDE),
      }));
      const xy = new Float64Array(dots.flatMap((d) => [d.x, d.y]));
      place(m as unknown as Mixer<Dot, Pose>, dots, xy, 2);
      const area = { x: 7, y: 9, r: 2 };
      let calls = 0;
      const wide = (s: Dot) => {
        calls++;
        return Math.max(0, 1 - Math.hypot(s.x - area.x, s.y - area.y) / 6);
      };
      m.cue({ patch: flicker(), loop: true });
      const glow = m.cue({
        patch: patch<Dot, Pose>(1000, () => ({ gain: 1.5 }), { writes: ['gain'] }),
        weight: wide,
        loop: true,
      });
      bound(m as unknown as Mixer<Dot, Pose>, glow as unknown as VoiceHandle<Dot, Pose>, area);
      const out = {} as Pose;
      const inside = dots.filter((d) => (d.x - 7) ** 2 + (d.y - 9) ** 2 <= 4);
      for (let f = 0; f < 10; f++) {
        calls = 0;
        m.sync(f * 16.7);
        for (const d of dots) m.probe(d, out);
        // A first read of a subject may call it twice, once on each path.
        if (f > 2) expect(calls).toBe(inside.length);
      }
      for (const d of dots) expect(glow.weightOf(d) > 0, `${d.x},${d.y}`).toBe(inside.includes(d));
    });
});
