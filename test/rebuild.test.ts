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

// A spring toward 100 by semi-implicit Euler, so its value depends on how it was stepped.
const spring = () =>
  patch<Part, Pose, { x: number; v: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0, v: 0 }),
    step: (s, dt) => {
      const h = dt / 1000;
      s.v += (180 * (100 - s.x) - 12 * s.v) * h;
      s.x += s.v * h;
    },
  });

const FRAME = 1000 / 60;

/** A voice cued fresh and played at 60 fps until its clock reads `elapsed`. */
function fresh(elapsed: number, opts: MixOptions<Part> = {}): number {
  const m = mix<Part, Pose>(K, opts);
  m.cue({ patch: spring(), start: 0 });
  const part = { id: 'a' };
  let x = 0;
  for (let t = 0; t <= elapsed + 1e-9; t += FRAME) {
    m.sync(t);
    x = m.probe(part).x;
  }
  m.sync(elapsed);
  return m.probe(part).x ?? x;
}

describe('a handle seek rebuilds state', () => {
  it('back to the start reads what a fresh voice does, under stepMs', () => {
    const m = mix<Part, Pose>(K, { stepMs: 5 });
    const h = m.cue({ patch: spring(), start: 0 });
    const part = { id: 'a' };
    for (let t = 0; t <= 300; t += FRAME) {
      m.sync(t);
      m.probe(part);
    }
    expect(m.probe(part).x).toBeGreaterThan(100);
    expect(h.seek(0)).toBe('exact');
    m.sync(m.now + 20);
    expect(m.probe(part).x).toBe(fresh(20, { stepMs: 5 }));
  });

  it('ahead, steps state to the new position', () => {
    const m = mix<Part, Pose>(K, { stepMs: 5 });
    const h = m.cue({ patch: spring(), start: 0 });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    h.seek(300);
    m.sync(0 + FRAME);
    expect(m.probe(part).x).toBe(fresh(300 + FRAME, { stepMs: 5 }));
  });

  it('says how sure it is', () => {
    const m = mix<Part, Pose>(K);
    const stepped = m.cue({ patch: spring(), start: 0 });
    const stateless = m.cue({
      patch: patch<Part, Pose>(100, (p) => ({ x: p }), { writes: ['x'] }),
    });
    m.sync(0);
    m.probe({ id: 'a' });
    expect(stepped.seek(0)).toBe('stepped');
    expect(stepped.seek(0, { state: 'keep' })).toBe('held');
    expect(stateless.seek(0)).toBe('exact');
    expect(mix<Part, Pose>(K, { stepMs: 5, maxDt: 50 }).cue({ patch: spring() }).seek(0)).toBe(
      'stepped',
    );
  });

  it('without stepMs catches the new position up in one step from fresh state', () => {
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: spring(), start: 0 });
    const part = { id: 'a' };
    for (let t = 0; t <= 300; t += FRAME) {
      m.sync(t);
      m.probe(part);
    }
    h.seek(0);
    m.sync(m.now + 10);
    // One step of 10 ms from rest: v = 180 · 100 · 0.01, x = v · 0.01.
    expect(m.probe(part).x).toBeCloseTo(1.8, 9);
  });

  it('is undone by a mix seek back to before it, and made again by the tape going forward', () => {
    const m = mix<Part, Pose>(K, { stepMs: 5, history: { ms: 5000, every: 50, tape } });
    const h = m.cue({ patch: spring(), start: 0 });
    const part = { id: 'a' };
    const seen = new Map<number, number>();
    let t = 0;
    for (; t <= 300; t += FRAME) {
      m.sync(t);
      seen.set(t, m.probe(part).x);
    }
    const at = m.now;
    h.seek(0);
    for (let u = at + FRAME; u <= at + 200; u += FRAME) {
      m.sync(u);
      seen.set(m.now, m.probe(part).x);
    }
    const before = [...seen.keys()].filter((k) => k <= at && k > 100)[0] as number;
    const after = [...seen.keys()].filter((k) => k > at + 50)[0] as number;
    m.seek(before);
    expect(m.probe(part).x).toBe(seen.get(before));
    m.seek(after);
    expect(m.probe(part).x).toBe(seen.get(after));
  });
});
