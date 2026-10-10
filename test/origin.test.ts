import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, Mix, MixOptions, VoiceSpec } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
  at?: number;
}
const a: Part = { id: 'a' };

const fall = keys<Part, Pose>(300, [
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

type Call = (m: Mix<Part, Pose>, h: Handle<Part>) => void;

/**
 * Cues `spec` at 0, makes each call at its time, and probes `subject` at `frames` only; the pose at
 * `end`.
 */
function at(
  spec: () => VoiceSpec<Part, Pose>,
  calls: Record<number, Call>,
  frames: number[],
  end: number,
  subject: Part = a,
  opts: MixOptions = {},
): Pose {
  const m = mix<Part, Pose>(K, opts);
  m.sync(0);
  const h = m.cue(spec());
  const times = [...new Set([...frames, ...Object.keys(calls).map(Number), end])].sort(
    (x, y) => x - y,
  );
  let pose: Pose = {} as Pose;
  for (const t of times) {
    if (t > 0) m.sync(t);
    calls[t]?.(m, h);
    if (frames.includes(t) || t === end) pose = { ...m.probe(subject) };
  }
  return pose;
}

const dense = (to: number) => Array.from({ length: to / 10 + 1 }, (_, i) => i * 10);

describe("a subject's origin does not depend on when the host first probes it", () => {
  it('a rate change before the first probe leaves the fade-in where it began', () => {
    const spec = () => ({ patch: fall, start: 0, fade: { in: 100 } });
    const calls = { 50: (_m: Mix<Part, Pose>, h: Handle<Part>) => (h.rate = 4) };
    const probed = at(spec, calls, dense(60), 60);
    const late = at(spec, calls, [], 60);
    expect(late.gain).toBeCloseTo(probed.gain, 9);
    // Faded in from 0: 60% of the way at 60 ms.
    expect(probed.gain).toBeCloseTo(1 - 0.6 * (1 - (1 - (0.8 * (50 + 10 * 4)) / 300)), 9);
  });

  it('a ramp before the first probe leaves the fade-in where it began', () => {
    const spec = () => ({ patch: fall, start: 0, fade: { in: 100 } });
    const calls = { 30: (_m: Mix<Part, Pose>, h: Handle<Part>) => h.ramp(3, 40) };
    const probed = at(spec, calls, dense(80), 80);
    const late = at(spec, calls, [], 80);
    expect(late.gain).toBeCloseTo(probed.gain, 9);
  });

  it('a stateful voice met late steps from its origin', () => {
    const spec = () => ({ patch: drift(), start: 0, rate: 0.5 });
    const calls = { 64: (_m: Mix<Part, Pose>, h: Handle<Part>) => (h.rate = 3) };
    const opts = { stepMs: 4 };
    const probed = at(spec, calls, dense(120), 120, a, opts);
    const late = at(spec, calls, [120], 120, a, opts);
    expect(probed.x).toBeGreaterThan(0);
    expect(late.x).toBeCloseTo(probed.x, 9);
  });

  it('a rate change before a staggered subject starts moves its start, probed or not', () => {
    const spec = () => ({
      patch: fall,
      start: 0,
      fade: { in: 100 },
      stagger: (p: Part) => p.at ?? 0,
    });
    const b: Part = { id: 'b', at: 200 };
    const calls = { 100: (_m: Mix<Part, Pose>, h: Handle<Part>) => (h.rate = 2) };
    // The clock reads 100 at 100 ms and 200 at 150: b fades in from 150, half way by 200.
    const probed = at(spec, calls, dense(200), 200, b);
    const late = at(spec, calls, [], 200, b);
    expect(late.gain).toBeCloseTo(probed.gain, 9);
    expect(probed.gain).toBeCloseTo(1 - 0.5 * (0.8 * (100 / 300)), 9);
  });

  it('a handle seek before the first probe leaves the fade-in where it began', () => {
    const spec = () => ({ patch: fall, start: 0, fade: { in: 100 } });
    const calls = { 40: (_m: Mix<Part, Pose>, h: Handle<Part>) => void h.seek(150) };
    const probed = at(spec, calls, dense(60), 60);
    const late = at(spec, calls, [], 60);
    expect(late.gain).toBeCloseTo(probed.gain, 9);
  });

  for (const lanes of [true, false])
    it(`a handle seek in the frame of the cue leaves the fade-in where it began, probed before it or not${lanes ? '' : ', without lanes'}`, () => {
      const run = (before: boolean) => {
        const m = mix<Part, Pose>(K, { lanes });
        m.sync(0);
        const h = m.cue({ patch: fall, start: 0, fade: { in: 100 } });
        if (before) m.probe(a);
        h.seek(150);
        m.sync(60);
        return m.probe(a).gain;
      };
      // 210 ms into the fall is 0.44, faded in by 0.6.
      expect(run(true)).toBeCloseTo(1 - 0.6 * (1 - 0.44), 9);
      expect(run(false)).toBeCloseTo(run(true), 9);
    });

  it('a stateful voice seeked before its first probe is rebuilt from where the seek puts it', () => {
    const spec = () => ({ patch: drift(), start: 0 });
    const calls = { 40: (_m: Mix<Part, Pose>, h: Handle<Part>) => void h.seek(150) };
    const opts = { stepMs: 4 };
    const probed = at(spec, calls, dense(80), 80, a, opts);
    const late = at(spec, calls, [80], 80, a, opts);
    expect(late.x).toBeCloseTo(probed.x, 9);
  });

  it('project ahead steps a stateful voice whose anchored start falls inside the window', () => {
    const run = () => {
      const m = mix<Part, Pose>(K, { stepMs: 4 });
      m.sync(0);
      const h = m.cue({ patch: fall, loop: true, name: 'lead' });
      m.cue({
        patch: drift(),
        rate: 2,
        freeze: 'before',
        fade: { in: 120 },
        anchor: { start: { after: 'lead', by: -20 } },
      });
      m.probe(a);
      m.sync(100);
      h.fade({ over: 200 });
      m.probe(a);
      return m;
    };
    // The lead is out at 300, so the drift starts at 280.
    const ahead = run().project(320).probe(a).x;
    const m = run();
    for (let t = 116; t <= 320; t += 16) {
      m.sync(t);
      m.probe(a);
    }
    m.sync(320);
    expect(m.probe(a).x).toBeGreaterThan(0);
    expect(ahead).toBeCloseTo(m.probe(a).x, 9);
  });
});
