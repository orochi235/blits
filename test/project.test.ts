import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { level, slew } from '../src/signals.js';
import type { Mix, MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const ramp = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 1 } },
  { at: 1, delta: { gain: 0.2 } },
]);
// Integrates toward 50 by explicit Euler, so its value depends on how it is stepped.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

/** Plays a scene frame by frame and returns the pose at every frame, keyed by time. */
function play(
  build: (m: Mix<Part, Pose>, at: number) => void,
  frames: number[],
  subject: Part,
  opts: MixOptions = {},
): { m: Mix<Part, Pose>; poses: Map<number, Pose> } {
  const m = mix<Part, Pose>(K, opts);
  const poses = new Map<number, Pose>();
  for (const t of frames) {
    m.sync(t);
    build(m, t);
    poses.set(t, { ...m.probe(subject) });
  }
  return { m, poses };
}

const every = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

describe('project ahead', () => {
  it('gives what the mix will probe at that time, and moves nothing', () => {
    const a = { id: 'a' };
    const scene = (m: Mix<Part, Pose>, t: number) => {
      if (t === 0) {
        m.cue({ patch: wave, fade: { in: 100 } });
        m.cue({ patch: ramp, start: 120, loop: false, fade: { out: 80 } });
      }
    };
    const frames = every(0, 600, 16);
    const { poses } = play(scene, frames, a);

    const m = mix<Part, Pose>(K);
    m.sync(0);
    scene(m, 0);
    const now = m.probe(a);
    for (const t of [16, 112, 128, 400, 432, 592]) {
      expect(m.project(t).probe(a)).toEqual(poses.get(t));
      expect(m.project(t).assess(a)).toEqual({ x: 'exact', gain: 'exact' });
    }
    expect(m.probe(a)).toEqual(now);
  });

  it('leaves the live mix playing exactly as if it had never been read ahead', () => {
    const a = { id: 'a' };
    const run = (peek: boolean) => {
      const m = mix<Part, Pose>(K);
      m.cue({ patch: drift() });
      m.cue({ patch: wave, weight: slew(() => 1, { riseMs: 200 }) });
      const xs: number[] = [];
      for (const t of every(0, 300, 20)) {
        m.sync(t);
        if (peek) m.project(t + 500).probe(a);
        xs.push(m.probe(a).x);
      }
      return xs;
    };
    expect(run(true)).toEqual(run(false));
  });

  it("doesn't use up a spring's retarget, and applies it in the projection", () => {
    const a = { id: 'a' };
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const m = mix<Part, Pose>(K);
    m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    m.sync(100);
    m.probe(a);
    s.to(a, -50);
    const ahead = m.project(1500).probe(a).x;
    expect(ahead).toBeLessThan(0);
    m.sync(116);
    m.probe(a);
    expect(s.read(a)?.value).toBeLessThan(100);
    m.sync(1500);
    expect(m.probe(a).x).toBeCloseTo(ahead, 3);
  });

  it('says stepped for state advanced in one go, and exact under stepMs', () => {
    const a = { id: 'a' };
    const loose = mix<Part, Pose>(K);
    loose.cue({ patch: drift() });
    loose.sync(0);
    loose.probe(a);
    expect(loose.project(400).assess(a).x).toBe('stepped');

    const fixed = mix<Part, Pose>(K, { stepMs: 10 });
    fixed.cue({ patch: drift() });
    fixed.sync(0);
    fixed.probe(a);
    const p = fixed.project(400);
    expect(p.assess(a).x).toBe('exact');
    const { poses } = play(
      (m, t) => {
        if (t === 0) m.cue({ patch: drift() });
      },
      every(0, 400, 20),
      a,
      { stepMs: 10 },
    );
    expect(p.probe(a).x).toBeCloseTo((poses.get(400) as Pose).x, 9);
  });

  it('says held for a channel fed by input from outside the clock', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K);
    m.cue({ patch: wave, weight: level(1) });
    m.cue({ patch: ramp });
    m.sync(0);
    m.probe(a);
    expect(m.project(200).assess(a)).toEqual({ x: 'held', gain: 'exact' });
  });

  it('sends nothing to the live mix', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K, { stepMs: 5 });
    m.cue({
      patch: patch<Part, Pose, { n: number }>(0, () => ({}), {
        writes: [],
        state: () => ({ n: 0 }),
        step: (s, _dt, _subject, setting) => setting.send(s.n++),
      }),
    });
    m.sync(0);
    m.probe(a);
    m.project(100).probe(a);
    expect(m.drain()).toEqual([]);
  });
});

describe('project back', () => {
  it('needs history, and only reaches as far back as it keeps', () => {
    const a = { id: 'a' };
    const without = mix<Part, Pose>(K);
    without.cue({ patch: wave });
    without.sync(0);
    without.sync(100);
    expect(() => without.project(50)).toThrow(/history/);

    const kept = mix<Part, Pose>(K, { history: { ms: 1000 } });
    kept.cue({ patch: wave });
    kept.sync(0);
    kept.probe(a);
    kept.sync(3000);
    expect(() => kept.project(1000)).toThrow(/older/);
    expect(() => kept.project(2000)).not.toThrow();
  });

  it('reads back to the pose the mix showed, through fades, handle changes and voices that left', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const handles: Record<string, ReturnType<Mix<Part, Pose>['cue']>> = {};
    const scene = (m: Mix<Part, Pose>, t: number) => {
      if (t === 0) {
        handles.wave = m.cue({ patch: wave, fade: { in: 100, out: 150 } });
        handles.drift = m.cue({ patch: drift(), weight: slew(() => 1, { riseMs: 300 }) });
        handles.ramp = m.cue({ patch: ramp, start: 200, loop: 2, fade: { out: 60 } });
      }
      if (t === 240) (handles.wave as { rate: number }).rate = 2;
      if (t === 320) (handles.drift as { weight: number }).weight = 0.5;
      if (t === 400) handles.wave?.fade();
      if (t === 480) handles.drift?.seek(100);
    };
    const frames = every(0, 1200, 16);
    const opts: MixOptions = { history: { ms: 5000, every: 50 }, stepMs: 4 };
    const live = play(scene, frames, a, opts);
    const other = play(scene, frames, b, opts);
    for (const t of frames.slice(0, -1)) {
      expect(live.m.project(t).probe(a)).toEqual(live.poses.get(t));
      expect(other.m.project(t).probe(b)).toEqual(other.poses.get(t));
    }
  });

  it('gives the same picture on a round trip back and forth', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K, { history: { ms: 10_000, every: 100 }, stepMs: 5 });
    m.cue({ patch: drift() });
    m.cue({ patch: wave, fade: { in: 200 } });
    const seen = new Map<number, Pose>();
    for (const t of every(0, 2000, 20)) {
      m.sync(t);
      seen.set(t, { ...m.probe(a) });
    }
    for (const t of [1980, 1000, 1980, 140, 1000, 140])
      expect(m.project(t).probe(a)).toEqual(seen.get(t));
  });

  it('reads a retargeted spring back to where it was before the retarget', () => {
    const a = { id: 'a' };
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const m = mix<Part, Pose>(K, { history: { ms: 5000 } });
    m.cue({ patch: s });
    const seen = new Map<number, number>();
    for (const t of every(0, 800, 16)) {
      m.sync(t);
      if (t === 304) s.to(a, -40);
      seen.set(t, m.probe(a).x);
    }
    for (const t of [96, 288, 320, 640]) {
      expect(m.project(t).probe(a).x).toBe(seen.get(t));
      expect(m.project(t).assess(a).x).toBe('exact');
    }
  });

  it('starts a subject it kept nothing for from its voice start, exact under stepMs', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K, { history: { ms: 5000, every: 1_000_000 }, stepMs: 5 });
    m.cue({ patch: drift() });
    const seen = new Map<number, number>();
    for (const t of every(0, 600, 20)) {
      m.sync(t);
      seen.set(t, m.probe(a).x);
    }
    expect(m.project(300).probe(a).x).toBeCloseTo(seen.get(300) as number, 9);
  });

  it('reads input back from a recording when history keeps inputs, and holds it otherwise', () => {
    const a = { id: 'a' };
    const run = (inputs: boolean) => {
      const knob = level<Part>(0.2);
      const m = mix<Part, Pose>(K, { history: { ms: 5000, inputs } });
      m.cue({ patch: wave, weight: slew(knob, { riseMs: 100, fallMs: 100 }) });
      const seen = new Map<number, number>();
      for (const t of every(0, 1000, 20)) {
        m.sync(t);
        if (t === 200) knob.set(0.9);
        if (t === 600) knob.set(0.4);
        seen.set(t, m.probe(a).x);
      }
      return { m, seen };
    };
    const kept = run(true);
    for (const t of [100, 220, 260, 640, 980]) {
      expect(kept.m.project(t).probe(a).x).toBe(kept.seen.get(t));
      expect(kept.m.project(t).assess(a).x).toBe('exact');
    }
    const lost = run(false);
    expect(lost.m.project(260).assess(a).x).toBe('held');
  });

  it('reads a patch back through the host fields it read then, when history keeps inputs', () => {
    const a = { id: 'a' };
    const run = (inputs: boolean) => {
      const host = { pointer: { x: 0 } };
      const follow = patch<Part, Pose>(
        0,
        (_p, _s, st) => ({ x: (st.host as typeof host).pointer.x }),
        { writes: ['x'], reads: ['pointer'] },
      );
      const m = mix<Part, Pose>(K, { host, history: { ms: 5000, inputs } });
      m.cue({ patch: follow });
      const seen = new Map<number, number>();
      for (const t of every(0, 600, 20)) {
        host.pointer.x = t < 300 ? t / 10 : 30;
        m.sync(t);
        seen.set(t, m.probe(a).x);
      }
      return { m, seen };
    };
    const kept = run(true);
    for (const t of [40, 200, 300, 580]) {
      expect(kept.m.project(t).probe(a).x).toBe(kept.seen.get(t));
      expect(kept.m.project(t).assess(a).x).toBe('exact');
    }
    expect(run(false).m.project(200).assess(a).x).toBe('held');
  });

  it('keeps no more than its horizon', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K, { history: { ms: 200, every: 20 } });
    const h = m.cue({ patch: drift() });
    for (const t of every(0, 5000, 10)) {
      m.sync(t);
      m.probe(a);
      h.weight = (t % 100) / 100;
      if (t % 500 === 0) m.cue({ patch: wave, loop: false, fade: { out: 0 } });
    }
    const inner = m as unknown as {
      gone: unknown[];
      cued: { log: unknown[] | null; subjects: { get(s: Part): { snaps?: unknown[] } } }[];
    };
    expect(inner.gone.length).toBeLessThanOrEqual(2);
    const voice = inner.cued[0] as (typeof inner.cued)[number];
    expect((voice.log as unknown[]).length).toBeLessThanOrEqual(22);
    expect((voice.subjects.get(a).snaps as unknown[]).length).toBeLessThanOrEqual(12);
  });
});
