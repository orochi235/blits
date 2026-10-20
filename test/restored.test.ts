import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { record } from '../src/record.js';
import { Restored } from '../src/restored.js';
import { Store } from '../src/store.js';
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

  it('holds no more after 12,000 seeks back, each to a later moment than the last', async () => {
    const m = mix<Part, Pose>(K, kept());
    for (let v = 0; v < 3; v++) m.cue({ patch: drift(), loop: true });
    const subjects = [{ id: 'a' }, { id: 'b' }];
    // Probed once and then left alone, so its record keeps the stamp of the first seek.
    const alone = { id: 'alone' };
    let host = 0;
    const frames = (n: number) => {
      for (let f = 0; f < n; f++) {
        host += 16;
        const now = m.now;
        if (now > 100) {
          m.seek(now - 48);
          m.seek(now);
        }
        m.sync(host);
        for (const s of subjects) m.probe(s);
        if (host < 100) m.probe(alone);
      }
    };
    // A weak reference keeps what it reaches until the job that made or read it ends, so the
    // frames run in turns, as a host's do.
    const heap = async () => {
      await new Promise((r) => setTimeout(r, 0));
      globalThis.gc?.();
      globalThis.gc?.();
      return process.memoryUsage().heapUsed;
    };
    // Past history's 5 s, so what it keeps has stopped growing.
    for (let i = 0; i < 4; i++) {
      frames(1000);
      await heap();
    }
    const before = await heap();
    for (let i = 0; i < 12; i++) {
      frames(1000);
      await heap();
    }
    expect((await heap()) - before).toBeLessThan(400_000);
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

describe("a chain's record found again", () => {
  const store = () =>
    new Restored<object>(new Store(), { now: (_key, held) => held, make: (live) => live });
  const a = {};
  const b = {};

  it('is the one the store holds, not one it let go of or replaced', () => {
    const r = store();
    const x = record(null, true, undefined);
    const y = record(null, true, undefined);
    r.set(a, x);
    expect(r.find(a, x)).toBe(x);
    r.set(a, y);
    expect(r.find(a, x)).toBe(y);
    r.delete(a);
    expect(r.find(a, y)).toBeUndefined();
  });

  it('is looked up once a record let go of is set again, under any key', () => {
    const r = store();
    const x = record(null, true, undefined);
    r.set(a, x);
    r.delete(a);
    r.set(b, x);
    expect(r.find(a, x)).toBeUndefined();
    expect(r.find(b, x)).toBe(x);
  });

  it('is looked up for a record another store stamped', () => {
    const r = store();
    const other = store();
    const x = record(null, true, undefined);
    other.set(a, x);
    expect(r.find(a, x)).toBeUndefined();
  });
});
