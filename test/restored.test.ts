import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { MixOptions } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Part {
  id: string;
}

const kept = (): MixOptions => ({ history: { ms: 5000, every: 50, tape }, stepMs: 4 });
const wave = () => patch<Part, Pose>(400, (phase) => ({ x: phase }), { writes: ['x'] });
// Integrates toward 50 by explicit Euler, so its value depends on how it is stepped.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });

describe('seek, many times over', () => {
  it('reads a subject no probe asked for between 20,000 seeks', () => {
    const m = mix<Part, Pose>(K, kept());
    m.cue({ patch: wave() });
    const a = { id: 'a' };
    const b = { id: 'b' };
    m.sync(0);
    m.probe(a);
    m.probe(b);
    for (const t of [16, 32, 48, 64]) {
      m.sync(t);
      m.probe(a);
    }
    for (let i = 0; i < 20000; i++) {
      m.seek(i % 2 === 0 ? 32 : 16);
      m.seek(64);
      m.probe(a);
    }
    m.seek(32);
    expect(m.probe(b).x).toBeCloseTo(32 / 400);
  });

  it('reads nothing past an earlier seek, after a later one to ahead of it', () => {
    let made = 0;
    const m = mix<Part, Pose>(K, kept());
    m.cue({
      patch: patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
        writes: ['x'],
        state: () => ({ x: ++made }),
        step: () => {},
      }),
    });
    const a = { id: 'a' };
    const b = { id: 'b' };
    let host = 0;
    for (; host <= 208; host += 16) {
      m.sync(host);
      m.probe(a);
      if (host >= 96) m.probe(b);
    }
    host -= 16;
    // Before `b` was first asked for, so the mix holds nothing for it from here.
    m.seek(48);
    for (let t = 64; t <= 208; t += 16) {
      host += 16;
      m.sync(host);
      m.probe(a);
    }
    m.seek(152);
    const before = made;
    m.probe(b);
    expect(made).toBe(before + 1);
  });

  for (const lanes of [true, false])
    it(`reads a subject left alone between seeks as one probed after each${lanes ? '' : ', without lanes'}`, () => {
      // Each seek back, the host time it plays on to, and the mix time that lands on.
      const hops: [number, number][] = [
        [96, 240],
        [160, 400],
        [48, 320],
        [208, 480],
        [200, 208],
      ];
      const a = { id: 'a' };
      const b = { id: 'b' };
      const run = (each: boolean) => {
        const m = mix<Part, Pose>(K, { ...kept(), lanes });
        m.cue({ patch: drift() });
        m.cue({ patch: wave() });
        let host = 0;
        for (; host <= 320; host += 16) {
          m.sync(host);
          m.probe(a);
          m.probe(b);
        }
        host -= 16;
        for (const [to, on] of hops) {
          m.seek(to);
          if (each) m.probe(b);
          for (let t = to + 16; t <= on; t += 16) {
            host += 16;
            m.sync(host);
            m.probe(a);
          }
          if (each) m.probe(b);
        }
        return { a: m.probe(a).x, b: m.probe(b).x };
      };
      const alone = run(false);
      const asked = run(true);
      expect(alone.b).toBe(asked.b);
      expect(alone.a).toBe(asked.a);
    });
});
