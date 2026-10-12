import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
const a = { id: 'a' };
const b = { id: 'b' };
const kept = (): MixOptions => ({ history: { ms: 100_000, every: 50, tape }, stepMs: 4 });

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const saw = patch<Part, Pose>(200, (phase) => ({ x: phase * 30 }), { writes: ['x'] });
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

type Scene = (m: Mix<Part, Pose>, t: number, h: Record<string, Handle<Part>>) => void;
const frames: number[] = [];
for (let t = 0; t <= 800; t += 16) frames.push(t);
const probes = (m: { probe(s: Part): Pose }) =>
  [a, b].flatMap((s) => [m.probe(s).x, m.probe(s).gain]);

/** Plays a scene's calls after each frame's sync, keeping what each frame showed. */
function play(scene: Scene) {
  const m = mix<Part, Pose>(K, kept());
  const h: Record<string, Handle<Part>> = {};
  const poses = new Map<number, number[]>();
  const mixT = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, h);
    poses.set(t, probes(m));
    mixT.set(t, m.now);
  }
  return { m, poses, mixT };
}

/** Seeks back to `from` and reads ahead to every later frame, then plays on through them. */
function readsAhead(scene: Scene, from: number) {
  const run = play(scene);
  run.m.seek(run.mixT.get(from) as number);
  const depth = run.m.tape?.undoDepth();
  for (const f of frames.filter((f) => f > from)) {
    const got = probes(run.m.project(run.mixT.get(f) as number));
    const want = run.poses.get(f) as number[];
    for (let i = 0; i < got.length; i++)
      expect(got[i], `project(${f})`).toBeCloseTo(want[i] as number, 9);
  }
  expect(run.m.tape?.undoDepth()).toBe(depth);
  const last = frames[frames.length - 1] as number;
  for (const f of frames.filter((f) => f > from)) {
    run.m.sync(last + (f - from));
    expect(probes(run.m), `frame ${f}`).toEqual(run.poses.get(f));
  }
}

describe('a read ahead after a seek back', () => {
  it('plays cues, handle writes, a mute and a drop the tape holds', () =>
    readsAhead((m, t, h) => {
      if (t === 0) h.wave = m.cue({ patch: wave, fade: { in: 100, out: 150 } });
      if (t === 240) h.drift = m.cue({ patch: drift() });
      if (t === 256) h.ramp = m.cue({ patch: ramp, start: 300, loop: 2, fade: { out: 60 } });
      if (t === 304) (h.wave as { rate: number }).rate = 2;
      if (t === 352) (h.drift as { weight: number }).weight = 0.5;
      if (t === 400) h.wave?.fade({ over: 200 });
      if (t === 432) h.drift?.seek(100);
      if (t === 480) h.wave?.rise({ over: 50 });
      if (t === 528) m.drop(a);
      if (t === 560) h.ramp?.fade({ subject: b, over: 80 });
      if (t === 640) m.mute({ over: 100 });
    }, 208));

  it("plays the mix's rate changes, and a start the host gave by its own clock across them", () =>
    readsAhead((m, t, h) => {
      if (t === 96) h.ramp = m.cue({ patch: ramp, start: 196, loop: 2, freeze: 'both' });
      if (t === 304) m.rate = 2;
      if (t === 400) m.ramp(0.5, 100);
    }, 96));

  it('plays spring retargets and pushes, timed and not, and leaves the patch as it was', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    readsAhead((m, t) => {
      if (t === 0) m.cue({ patch: s });
      if (t === 96) s.to(a, 20, 500);
      if (t === 304) s.to(a, -40);
      if (t === 352) s.to(a, 60, 380);
      if (t === 400) s.push(b, 300);
    }, 208);
  });

  it('plays a cue under an owner, and a blend, made after the moment', () =>
    readsAhead((m, t, h) => {
      if (t === 0) h.wave = m.cue({ patch: wave });
      if (t === 256) {
        h.owner = m.owns({ fade: { in: 50 } });
        m.cue({ patch: drift(), owner: h.owner });
      }
      if (t === 320) m.blend([wave, saw], (s) => (s === a ? 0.25 : 1), { loop: true });
      if (t === 480) h.owner?.fade({ over: 100 });
    }, 208));

  it('reads every mix on a transport, an anchor across them answering', () => {
    const run = () => {
      const t = transport({ history: { ms: 100_000, tape } });
      const one = mix<Part, Pose>(K, { transport: t, name: 'one' });
      const two = mix<Part, Pose>(K, { transport: t, name: 'two' });
      const shown = new Map<number, number[]>();
      for (const f of frames) {
        t.sync(f);
        if (f === 256) one.cue({ patch: ramp, name: 'lead', score: 's' });
        if (f === 304)
          two.cue({ patch: wave, score: 's', anchor: { start: { of: 'lead', mark: 'end' } } });
        shown.set(f, [...probes(one), ...probes(two)]);
      }
      return { t, one, two, shown };
    };
    const r = run();
    r.t.seek(208);
    for (const f of frames.filter((f) => f > 208)) {
      const p = r.t.project(f);
      const got = [...probes(p.of(r.one)), ...probes(p.of(r.two))];
      const want = r.shown.get(f) as number[];
      for (let i = 0; i < got.length; i++)
        expect(got[i], `project(${f})`).toBeCloseTo(want[i] as number, 9);
    }
  });

  it('refuses a drop of a subject a motion patch holds, and leaves the tape holding it', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 100 });
    const m = mix<Part, Pose>(K, kept());
    m.cue({ patch: s });
    const shown = new Map<number, number[]>();
    for (const t of frames) {
      m.sync(t);
      if (t === 304) m.drop(a);
      shown.set(t, probes(m));
    }
    m.seek(208);
    expect(() => m.project(400)).toThrow(/tape holds a drop/);
    expect(probes(m.project(288))).toEqual(shown.get(288));
    m.seek(400);
    expect(probes(m)).toEqual(shown.get(400));
  });
});
