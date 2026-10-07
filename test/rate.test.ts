import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring, tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { level } from '../src/signals.js';
import type { Mix, MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };

/** x reads the voice's own elapsed ms, so a pose shows the voice clock. */
const clock = patch<Part, Pose>(0, (_p, _s, setting) => ({ x: setting.elapsed }), {
  writes: ['x'],
});
const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const fall = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 0.5 } },
  { at: 1, delta: { gain: 0.2 } },
]);
// Integrates toward 50 by explicit Euler, so its value depends on the dt it is handed.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

/** Plays a scene frame by frame and returns the pose at every frame, keyed by time. */
function play(
  build: (m: Mix<Part, Pose>, at: number) => void,
  frames: number[],
  opts: MixOptions = {},
): { m: Mix<Part, Pose>; poses: Map<number, Pose>; times: Map<number, number> } {
  const m = mix<Part, Pose>(K, opts);
  const poses = new Map<number, Pose>();
  const times = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    build(m, t);
    poses.set(t, { ...m.probe(a) });
    times.set(t, m.now);
  }
  return { m, poses, times };
}

describe('mix rate', () => {
  it('is 1 until set, and refuses a negative or endless rate', () => {
    const m = mix<Part, Pose>(K);
    expect(m.rate).toBe(1);
    m.rate = 0.5;
    expect(m.rate).toBe(0.5);
    expect(() => {
      m.rate = -1;
    }).toThrow(RangeError);
    expect(() => m.ramp(Number.POSITIVE_INFINITY, 100)).toThrow(RangeError);
    expect(() => m.ramp(Number.NaN, 100)).toThrow(RangeError);
    expect(m.rate).toBe(0.5);
  });

  it('multiplies into every voice rate, and a rate change keeps the clock continuous', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({ patch: clock, rate: 2 });
    m.sync(100);
    expect(m.probe(a).x).toBe(200);
    m.rate = 0.5;
    m.sync(300);
    expect(m.probe(a).x).toBe(400);
    m.rate = 0;
    m.sync(1000);
    expect(m.probe(a).x).toBe(400);
    expect(m.rate).toBe(0);
  });

  it('integrates a mix ramp under a voice ramp exactly: the rates multiply', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: clock });
    h.ramp(3, 400);
    m.ramp(0.25, 200);
    // Mix time s(u) = u − 0.75 u² / 400 to u = 200, then 125 + 0.25 (u − 200); the voice clock
    // integrates its own rate 1 + s / 200 over s, to s = 400.
    const s = (u: number) => (u <= 200 ? u - (0.75 * u * u) / 400 : 125 + 0.25 * (u - 200));
    const e = (t: number) => t + (t * t) / 400;
    for (const u of [50, 150, 200, 260, 700, 1300]) {
      m.sync(u);
      const t = s(u);
      expect(m.probe(a).x).toBeCloseTo(t <= 400 ? e(t) : e(400) + 3 * (t - 400), 9);
    }
    expect(m.rate).toBe(0.25);
  });

  it('scales fades, stagger and an anchor’s by with the voice clock', () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.rate = 0.5;
    m.cue({ patch: fall, name: 'f', loop: false, fade: { in: 100, out: 100 } });
    m.cue({ patch: wave, anchor: { start: { after: 'f', by: 50 } } });
    m.sync(100);
    // 50 mix ms into the pass, and halfway through a 100 ms fade in.
    const g = 0.5 + (0.2 - 0.5) * (50 / 300);
    expect(m.probe(a).gain).toBeCloseTo(1 + (g - 1) * 0.5, 9);
    const marks = m.marks(0, 10_000).map((k) => [k.voice, k.mark, k.timestamp]);
    expect(marks).toEqual([
      [1, 'start', 0],
      [1, 'in', 200],
      [1, 'coast', 600],
      [1, 'out', 600],
      [1, 'end', 800],
      [2, 'start', 900],
      [2, 'in', 900],
    ]);
  });

  it('hands step and signals a dt in mix time', () => {
    const dts: number[] = [];
    const m = mix<Part, Pose>(K);
    m.sync(0);
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: ['x'],
        state: () => null,
        step: (_s, dt) => {
          dts.push(dt);
        },
      }),
    });
    m.probe(a);
    m.rate = 0.25;
    m.sync(40);
    m.probe(a);
    expect(dts).toEqual([10]);
  });

  it('runs stepMs on mix time, so a slowed mix steps less often', () => {
    const run = (rate: number) => {
      const m = mix<Part, Pose>(K, { stepMs: 10 });
      m.rate = rate;
      m.sync(0);
      m.cue({ patch: drift() });
      m.sync(400 / rate);
      return m.probe(a).x;
    };
    expect(run(0.5)).toBe(run(1));
  });

  describe('at rate 0', () => {
    it('freezes every pose, and is inert while live', () => {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      m.cue({ patch: wave, fade: { in: 200 } });
      m.cue({ patch: fall });
      m.sync(50);
      const was = { ...m.probe(a) };
      m.rate = 0;
      expect(m.inert).toBe(false);
      m.sync(60);
      expect(m.inert).toBe(true);
      expect(m.live).toBe(true);
      for (const t of [100, 5000]) {
        m.sync(t);
        expect(m.probe(a)).toEqual(was);
      }
      m.rate = 1;
      expect(m.inert).toBe(false);
      m.sync(5016);
      expect(m.probe(a)).not.toEqual(was);
    });

    it('lands changes made while paused at the next sync', () => {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      const h = m.cue({ patch: wave });
      m.sync(100);
      m.rate = 0;
      m.sync(200);
      h.fade({ over: 0 });
      m.sync(300);
      expect(h.state).toBe('done');
      m.cue({ patch: fall });
      m.sync(400);
      expect(m.probe(a)).toEqual({ x: 0, gain: 0.5 });
      expect(m.inert).toBe(true);
    });

    it('still asks a weight signal, so one reading input follows it', () => {
      const pointer = level<Part>(0.25);
      const m = mix<Part, Pose>(K);
      m.sync(0);
      m.cue({ patch: fall, weight: pointer });
      m.rate = 0;
      m.sync(10);
      const low = m.probe(a).gain;
      pointer.set(1);
      m.sync(20);
      expect(m.probe(a).gain).not.toBe(low);
      expect(m.inert).toBe(false);
    });

    it('reads a blend’s signal again at each sync, so one reading input follows it', () => {
      for (const lanes of [false, true]) {
        const pointer = level<Part>(0.25);
        const m = mix<Part, Pose>(K, { lanes });
        m.sync(0);
        m.blend([wave, clock], pointer);
        m.sync(100);
        m.probe(a);
        m.rate = 0;
        m.sync(110);
        const low = m.probe(a).x;
        pointer.set(1);
        m.sync(120);
        expect(m.probe(a).x, `lanes ${lanes}`).not.toBe(low);
      }
    });
  });

  describe('host timestamps', () => {
    it('start a voice at the host moment given, whatever the rate does after the cue', () => {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      const h = m.cue({ patch: clock, start: 1000 });
      m.rate = 0.5;
      m.sync(999);
      expect(h.state).toBe('pending');
      m.sync(1000);
      expect(h.state).toBe('live');
      m.sync(1100);
      expect(m.probe(a).x).toBe(50);
      expect(m.marks(0, 2000).map((k) => k.timestamp)).toEqual([1000, 1000]);
    });

    it('hold a start ahead of a paused mix until the host reaches it', () => {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      m.rate = 0;
      const h = m.cue({ patch: fall, start: 500 });
      m.sync(400);
      expect(h.state).toBe('pending');
      expect(m.probe(a)).toEqual({ x: 0, gain: 1 });
      expect(m.inert).toBe(false);
      m.sync(500);
      expect(h.state).toBe('live');
      expect(m.probe(a)).toEqual({ x: 0, gain: 0.5 });
      m.sync(900);
      expect(m.probe(a)).toEqual({ x: 0, gain: 0.5 });
    });

    it('keep an announced mark and a numbered anchor where the host put them', () => {
      const m = mix<Part, Pose>(K);
      m.sync(0);
      m.announce('beat', { at: 800 });
      const on = m.cue({ patch: fall, anchor: { start: { with: 'beat' } } });
      const by = m.cue({ patch: wave, anchor: { start: 600 } });
      m.ramp(0.2, 300);
      m.sync(599);
      expect([on.state, by.state]).toEqual(['pending', 'pending']);
      m.sync(600);
      expect([on.state, by.state]).toEqual(['pending', 'live']);
      m.sync(800);
      expect(on.state).toBe('live');
      // A voice's marks are mix times turned back into host time, through the ramp's square root.
      const marks = m.marks(0, 1000);
      expect(marks.map((k) => [k.name ?? k.voice, k.mark])).toEqual([
        [3, 'start'],
        [3, 'in'],
        ['beat', undefined],
        [2, 'start'],
        [2, 'in'],
      ]);
      expect(marks[2]?.timestamp).toBe(800);
      for (const [k, t] of [600, 600, 800, 800, 800].entries())
        expect(marks[k]?.timestamp).toBeCloseTo(t, 9);
    });
  });

  describe('reading another time', () => {
    const scene = (m: Mix<Part, Pose>, t: number) => {
      if (t === 0) {
        m.cue({ patch: wave, fade: { in: 100, out: 150 } });
        m.cue({ patch: fall, start: 200, loop: 2, fade: { out: 60 } });
        m.cue({ patch: drift() });
      }
      if (t === 96) m.ramp(0.4, 200);
      if (t === 400) m.rate = 0;
      if (t === 560) m.ramp(1.5, 120);
      if (t === 800) m.rate = 1;
    };
    const frames = every(0, 1200, 16);

    it('reads ahead to what the mix probes when it gets there', () => {
      const { poses, times } = play(scene, frames, { stepMs: 4 });
      for (const from of [0, 96, 160, 400, 480, 560]) {
        const m = mix<Part, Pose>(K, { stepMs: 4 });
        for (const t of frames.filter((f) => f <= from)) {
          m.sync(t);
          scene(m, t);
          m.probe(a);
        }
        // Ahead the mix plays on at the rate it has, so read only up to the next change.
        const next = [96, 400, 560, 800, 1200].find((c) => c > from) as number;
        for (const t of frames.filter((f) => f > from && f <= next))
          expect(m.project(times.get(t) as number).probe(a), `${from} → ${t}`).toEqual(
            poses.get(t),
          );
      }
    });

    it('reads back to the pose the mix showed, through mix rate changes', () => {
      const opts: MixOptions = { history: { ms: 5000, every: 50 }, stepMs: 4 };
      const { m, poses, times } = play(scene, frames, opts);
      for (const t of frames.slice(0, -1))
        expect(m.project(times.get(t) as number).probe(a), `${t}`).toEqual(poses.get(t));
    });

    it('reads a paused spring back and ahead without moving it', () => {
      const s = spring<Part, Pose>('x', { from: 0, to: 100, stiffness: 170, damping: 26 });
      const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
      m.sync(0);
      m.cue({ patch: s });
      m.sync(100);
      const at100 = m.probe(a).x;
      m.rate = 0;
      m.sync(300);
      expect(m.probe(a).x).toBe(at100);
      expect(m.now).toBe(100);
      // Mix time 1000, which the paused mix has yet to reach, reads the spring all but landed.
      expect(m.project(1000).probe(a).x).toBeCloseTo(100, 2);
      expect(m.probe(a).x).toBe(at100);
      expect(m.project(50).probe(a).x).toBeLessThan(at100);
    });
  });

  it('gives the same bits with lanes on and off', () => {
    const run = (lanes: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` }));
      const t = tween<Part, Pose>('x', { from: 0, to: 40, ms: 300, ease: 'ease-out' });
      const out: number[] = [];
      for (const at of every(0, 900, 16)) {
        m.sync(at);
        if (at === 0) {
          m.cue({ patch: wave, stagger: (p) => Number(p.id.slice(1)) * 20 });
          m.cue({ patch: fall, loop: 3, fade: { in: 80, out: 80 } });
          m.cue({ patch: t, subjects: parts.slice(0, 3) });
        }
        if (at === 160) m.ramp(0.3, 240);
        if (at === 480) m.rate = 0;
        if (at === 560) m.ramp(2, 100);
        for (const p of parts) {
          const pose = m.probe(p);
          out.push(pose.x ?? Number.NaN, pose.gain ?? Number.NaN);
        }
      }
      return out;
    };
    const on = run(true);
    const off = run(false);
    expect(on.length).toBe(off.length);
    for (let i = 0; i < on.length; i++) expect(Object.is(on[i], off[i]), `${i}`).toBe(true);
  });
});
