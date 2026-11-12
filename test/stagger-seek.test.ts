import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { VoiceHandle } from '../src/handle.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Handle, Mix, MixOptions, Patch } from '../src/types.js';
import type { Voice } from '../src/voice.js';

// A `stagger` that answers anew on every ask, so a replay that asked again would place a subject
// elsewhere than the live mix did.

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
const kept = (ms = 100_000): MixOptions => ({ history: { ms, every: 50, tape }, stepMs: 4 });
const voiceOf = (h: Handle<Part>) =>
  VoiceHandle.voiceOf(h as unknown as VoiceHandle<Part, Pose>) as Voice<Part, Pose>;

const saw = patch<Part, Pose>(200, (phase) => ({ x: phase * 30 }), { writes: ['x'] });
// Integrates toward 50 by explicit Euler: a stateful record, kept in copies every 50 ms.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

const frames: number[] = [];
for (let t = 0; t <= 800; t += 16) frames.push(t);
const probes = (m: Mix<Part, Pose>) => [a, b].flatMap((s) => [m.probe(s).x, m.probe(s).gain]);

/** Counts every ask, answering 40, 80, 120… in turn. */
function asking() {
  const asks: Part[] = [];
  const stagger = (s: Part) => {
    asks.push(s);
    return 40 * asks.length;
  };
  return { asks, stagger };
}

type Scene = (m: Mix<Part, Pose>, t: number, stagger: (s: Part) => number) => void;

/** Plays `scene` live, then seeks back to each of `to` in turn and plays on to the end again. */
function replays(scene: Scene, ...to: number[]) {
  const { asks, stagger } = asking();
  const m = mix<Part, Pose>(K, kept());
  const poses = new Map<number, number[]>();
  const mixT = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, stagger);
    poses.set(t, probes(m));
    mixT.set(t, m.now);
  }
  const live = asks.slice();
  let host = frames[frames.length - 1] as number;
  for (const from of to) {
    m.seek(mixT.get(from) as number);
    const base = host;
    for (const f of frames.filter((f) => f > from)) {
      host = base + (f - from);
      m.sync(host);
      expect(probes(m), `frame ${f} after a seek back to ${from}`).toEqual(poses.get(f));
    }
  }
  return { live, asks };
}

const patches: [string, () => Patch<Part, Pose>][] = [
  ['a stateless patch', () => saw],
  ['a stateful patch', () => drift() as unknown as Patch<Part, Pose>],
];

describe('a replay after a seek back takes the answers `stagger` gave live', () => {
  for (const [name, make] of patches)
    for (const start of [0, 100])
      describe(`${name} starting at ${start}`, () => {
        it('asks for no subject again', () => {
          const { live, asks } = replays((m, t, stagger) => {
            if (t === 0) m.cue({ patch: make(), start, stagger });
          }, 48);
          expect(live).toEqual([a, b]);
          expect(asks).toEqual(live);
        });

        it('asks for no subject again after the drop it plays again', () => {
          const { live, asks } = replays((m, t, stagger) => {
            if (t === 0) m.cue({ patch: make(), start, stagger });
            if (t === 96) m.drop(b);
          }, 48);
          expect(asks).toEqual(live);
        });

        it('asks for no subject again over two seeks back', () => {
          const { live, asks } = replays(
            (m, t, stagger) => {
              if (t === 0) m.cue({ patch: make(), start, stagger });
              if (t === 96) m.drop(b);
              if (t === 304) m.drop(a);
            },
            400,
            48,
          );
          expect(asks).toEqual(live);
        });
      });

  it('asks for no subject again for a voice cued after the moment sought', () => {
    const { live, asks } = replays((m, t, stagger) => {
      if (t === 80) m.cue({ patch: drift(), stagger });
      if (t === 160) m.drop(a);
    }, 48);
    expect(asks).toEqual(live);
  });
});

describe("a voice's `stagger` answers", () => {
  it('are let go with the history that reaches the moment each was asked', () => {
    const { stagger } = asking();
    const m = mix<Part, Pose>(K, kept(1000));
    m.sync(0);
    const v = voiceOf(m.cue({ patch: saw, stagger }));
    for (let t = 16; t <= 32_000; t += 16) {
      m.sync(t);
      const s = { id: `s${t}` };
      m.probe(s);
      m.drop(s);
    }
    // An answer and a leaving a frame, for each of the 1000 ms history reaches.
    expect(v.staggers?.size).toBeGreaterThan(60);
    expect(v.staggers?.size).toBeLessThanOrEqual(2 * (1000 / 16 + 2));
  });

  it('are not kept without history', () => {
    const { stagger } = asking();
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const v = voiceOf(m.cue({ patch: saw, stagger }));
    m.sync(16);
    m.probe(a);
    expect(v.staggers ?? null).toBeNull();
  });
});
