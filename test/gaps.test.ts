import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const H = { history: { ms: 10_000, tape } };

// Integrates toward 50, so its value depends on everything it was stepped through.
// Seeded afresh each time a record is made, so a record started afresh shows.
let made = 0;
const drift = () =>
  patch<string, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 1000 * ++made }),
    step: (s) => {
      s.x += 1;
    },
  });

const frames = (m: ReturnType<typeof mix<string, Pose>>, from: number, to: number, s = 'a') => {
  const out: number[] = [];
  for (let t = from; t <= to; t += 16) {
    m.sync(t);
    out.push(m.probe(s).x);
  }
  return out;
};

describe('a seek back restores what left after it', () => {
  it('brings back a subject faded out of a voice after the moment sought, state and all', () => {
    const m = mix<string, Pose>(K, { ...H, stepMs: 16 });
    m.sync(0);
    const h = m.cue({ patch: drift() });
    frames(m, 16, 384);
    const at384 = m.probe('a').x;
    m.sync(400);
    m.probe('a');
    h.fade({ subject: 'a', over: 0 });
    m.sync(500);
    m.seek(384);
    expect(m.probe('a').x).toBe(at384);
  });

  it('brings back a dropped subject as it stood', () => {
    const m = mix<string, Pose>(K, { ...H, stepMs: 16 });
    m.sync(0);
    m.cue({ patch: drift() });
    frames(m, 16, 384);
    const at384 = m.probe('a').x;
    m.sync(400);
    m.probe('a');
    m.drop('a');
    m.sync(500);
    m.seek(384);
    expect(m.probe('a').x).toBe(at384);
  });

  it('brings back what a gone voice held for a subject dropped after the voice left', () => {
    for (const named of [true, false]) {
      const m = mix<string, Pose>(K, { ...H, stepMs: 16 });
      m.sync(0);
      // A voice over 'b' as well, gone with it, which the drop of 'a' must leave as it was.
      const h = m.cue({ patch: drift(), ...(named ? { subjects: ['a', 'b'] } : {}) });
      frames(m, 16, 384);
      m.probe('b');
      const at384 = m.probe('a').x;
      const b384 = m.probe('b').x;
      m.sync(400);
      m.probe('a');
      h.fade({ over: 0 });
      m.sync(450);
      m.drop('a');
      // Its record moved out of the gone voice, which still holds 'b'.
      const gone = (m as unknown as { gone: { subjects: { get(s: string): unknown } }[] }).gone;
      expect(gone.map((v) => [v.subjects.get('a'), v.subjects.get('b') !== undefined])).toEqual([
        [undefined, true],
      ]);
      m.sync(500);
      m.seek(384);
      expect(m.probe('a').x).toBe(at384);
      expect(m.probe('b').x).toBe(b384);
    }
  });

  it('lets go of gone voices past history and still drops a subject one of them named', () => {
    const m = mix<string, Pose>(K, { history: { ms: 200, tape }, stepMs: 16 });
    m.sync(0);
    for (let k = 0; k < 40; k++) {
      const h = m.cue({ patch: drift(), subjects: [`s${k}`] });
      m.sync(16 * (k + 1));
      m.probe(`s${k}`);
      h.fade({ over: 0 });
    }
    m.sync(16 * 41);
    for (let k = 0; k < 40; k++) m.drop(`s${k}`);
    const inner = m as unknown as { gone: unknown[] };
    // Only what the last 200 ms reaches is still kept.
    expect(inner.gone.length).toBeLessThan(40);
    expect(inner.gone.length).toBeGreaterThan(0);
  });

  it("brings back a motion patch's state for a subject dropped after the moment sought", () => {
    const m = mix<string, Pose>(K, { ...H, stepMs: 16 });
    const s = spring<string, Pose>('x', { to: 0, stiffness: 200, damping: 10 });
    m.sync(0);
    m.cue({ patch: s });
    m.sync(16);
    m.probe('a');
    s.to('a', 100);
    const before = frames(m, 32, 400);
    m.drop('a');
    m.sync(500);
    m.seek(32);
    expect(m.probe('a').x).toBeCloseTo(before[0] as number, 6);
  });

  it("plays a from: 'current' voice on from the pose it took, after a seek back", () => {
    const m = mix<string, Pose>(K, H);
    m.sync(0);
    m.cue({ patch: patch<string, Pose>(0, () => ({ x: 40 }), { writes: ['x'] }) });
    m.sync(16);
    m.probe('a');
    m.cue({
      patch: keys<string, Pose>(400, [{ at: 1, delta: { x: 100 } }]),
      from: 'current',
      locus: 'l',
      loop: false,
      freeze: 'after',
    });
    const live = frames(m, 32, 608);
    m.seek(208);
    // The host's clock reads on from the seek, 400 ms behind where it was.
    const again: number[] = [];
    for (let t = 224; t <= 608; t += 16) {
      m.sync(t + 400);
      again.push(m.probe('a').x);
    }
    expect(again).toEqual(live.slice((224 - 32) / 16));
  });

  it("keeps the pose a from: 'current' voice took, though the pose under it changed since", () => {
    const m = mix<string, Pose>(K, H);
    m.sync(0);
    const base = m.cue({ patch: patch<string, Pose>(0, () => ({ x: 40 }), { writes: ['x'] }) });
    m.sync(16);
    m.probe('a');
    m.cue({
      patch: keys<string, Pose>(400, [{ at: 1, delta: { x: 100 } }]),
      from: 'current',
      locus: 'l',
      loop: false,
      freeze: 'after',
    });
    const live: number[] = [];
    for (let t = 32; t <= 608; t += 16) {
      if (t === 160) base.weight = 0.5;
      m.sync(t);
      live.push(m.probe('a').x);
    }
    m.seek(208);
    const again: number[] = [];
    for (let t = 224; t <= 608; t += 16) {
      m.sync(t + 400);
      again.push(m.probe('a').x);
    }
    expect(again).toEqual(live.slice((224 - 32) / 16));
  });

  it('refuses a read ahead past calls the tape will play again, rather than leave them out', () => {
    const m = mix<string, Pose>(K, H);
    m.sync(0);
    m.sync(100);
    m.cue({ patch: patch<string, Pose>(0, () => ({ x: 1 }), { writes: ['x'] }) });
    m.sync(200);
    m.seek(50);
    expect(() => m.project(150)).toThrow(/tape/);
    expect(m.project(80).probe('a').x).toBe(0);
  });
});
