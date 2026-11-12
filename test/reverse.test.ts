import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Mix } from '../src/types.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };

// Integrates toward 50, so what it shows cannot be worked out from the time alone.
const drift = () =>
  patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: () => ({ x: 0 }),
    step: (s, dt) => {
      s.x += (50 - s.x) * Math.min(1, dt / 200);
    },
  });
const ramp = keys<Part, Pose>(300, [
  { at: 0, delta: { gain: 1 } },
  { at: 1, delta: { gain: 0.2 } },
]);
const line = patch<Part, Pose>(1000, (phase) => ({ x: 1 + phase }), { writes: ['x'] });

const made = () => mix<Part, Pose>(K, { history: { ms: 5000, every: 50, tape }, stepMs: 10 });

/** Plays a mix forward through a scene, recording what it showed at each mix time. */
function played(m: Mix<Part, Pose>, to = 2000) {
  const shown = new Map<number, Pose>();
  const springs = spring<Part, Pose>('x', { from: 0, to: 10 });
  for (let t = 0; t <= to; t += 20) {
    m.sync(t);
    if (t === 0) m.cue({ patch: drift() });
    if (t === 300) m.cue({ patch: ramp, loop: true, tags: ['ramp'], fade: { in: 100 } });
    if (t === 600) m.cue({ patch: springs });
    if (t === 700) springs.to(a, 30);
    if (t === 1000) springs.to(a, -10);
    if (t === 1200) m.voices('ramp')[0]?.fade({ over: 200 });
    shown.set(m.now, { ...m.probe(a) });
  }
  return shown;
}

describe('a mix rate below 0', () => {
  it('shows at each mix time what the mix showed playing through it', () => {
    const m = made();
    const shown = played(m);
    m.rate = -1;
    expect(m.rate).toBe(-1);
    for (let ts = 2020; ts <= 3800; ts += 20) {
      m.sync(ts);
      expect(m.now).toBe(2000 - (ts - 2000));
      expect(m.probe(a), `mix time ${m.now}`).toEqual(shown.get(m.now));
    }
  });

  it('runs back at its speed, and stops at the earliest moment history reaches, reading rate 0', () => {
    const m = made();
    const shown = played(m, 1000);
    m.rate = -2;
    for (let ts = 1020; ts <= 1600; ts += 20) m.sync(ts);
    expect(m.now).toBe(0);
    expect(m.rate).toBe(0);
    expect(m.probe(a)).toEqual(shown.get(0));
  });

  it('plays the tape on when turned forward, cutting nothing, and goes live past its last call', () => {
    const m = made();
    const shown = played(m);
    m.rate = -1;
    for (let ts = 2020; ts <= 3000; ts += 20) m.sync(ts);
    expect(m.now).toBe(1000);
    m.rate = 1;
    for (let ts = 3020; ts <= 4000; ts += 20) {
      m.sync(ts);
      expect(m.probe(a), `mix time ${m.now}`).toEqual(shown.get(m.now));
    }
    expect(m.now).toBe(2000);
    expect(m.rate).toBe(1);
    m.sync(4020);
    expect(m.now).toBe(2020);
  });

  it('turns forward at a rate of its own, which becomes the mix rate once the tape runs out', () => {
    const m = made();
    played(m);
    m.rate = -1;
    for (let ts = 2020; ts <= 2400; ts += 20) m.sync(ts);
    expect(m.now).toBe(1600);
    m.rate = 2;
    for (let ts = 2420; ts <= 2640; ts += 20) m.sync(ts);
    expect(m.now).toBe(2080);
    expect(m.rate).toBe(2);
    // Past the tape's last call (the fade at 1200) it is live, so the rate is the mix's own, and a
    // seek back finds it recorded.
    m.sync(2660);
    expect(m.now).toBe(2120);
    m.seek(2060);
    expect(m.rate).toBe(2);
  });

  it('eases through 0 under a ramp, turning where the rate crosses it', () => {
    const m = made();
    m.cue({ patch: line, loop: true });
    for (let t = 0; t <= 1000; t += 20) m.sync(t);
    m.ramp(-1, 200);
    // From 1 to -1 over 200 host ms: 50 ms further on at 100, back at 1000 by 200, then at -1.
    m.sync(1100);
    expect(m.now).toBeCloseTo(1050, 9);
    m.sync(1200);
    expect(m.now).toBeCloseTo(1000, 9);
    m.sync(1300);
    expect(m.now).toBeCloseTo(900, 9);
    expect(m.probe(a).x).toBeCloseTo(1.9, 9);
  });

  it('branches the tape at a host call made while running back', () => {
    const m = made();
    played(m);
    m.rate = -1;
    for (let ts = 2020; ts <= 2400; ts += 20) m.sync(ts);
    m.cue({ patch: patch<Part, Pose>(0, () => ({ x: 1000 }), { writes: ['x'] }), tags: ['late'] });
    m.sync(2420);
    expect(m.now).toBe(1580);
    // Running back from the cue takes it out, as a seek back to before it would.
    expect(m.voices('late')).toEqual([]);
    m.rate = 1;
    for (let ts = 2440; ts <= 2600; ts += 20) m.sync(ts);
    expect(m.now).toBe(1760);
    // The calls after the cue were cut: `ramp`'s fade at 1200 is behind, nothing ahead replays.
    expect(m.rate).toBe(1);
  });

  it('runs on from where a seek the host makes while running back lands', () => {
    const m = made();
    const shown = played(m);
    m.rate = -1;
    m.sync(2020);
    m.seek(1500);
    m.sync(2040);
    expect(m.now).toBe(1480);
    expect(m.probe(a)).toEqual(shown.get(1480));
  });

  it('says where a host timestamp falls, and when a mix time comes round', () => {
    const m = made();
    played(m, 1000);
    m.rate = -0.5;
    m.sync(1020);
    expect(m.now).toBe(990);
    expect(m.time(1220)).toBe(890);
    expect(m.when(890)).toBe(1220);
    expect(m.when(2000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('runs every mix on a transport back together', () => {
    const t = transport({ history: { ms: 5000, every: 50, tape } });
    const p = mix<Part, Pose>(K, { transport: t, name: 'p', stepMs: 10 });
    const q = mix<Part, Pose>(K, { transport: t, name: 'q', stepMs: 10 });
    const shown = new Map<number, [number, number]>();
    for (let ts = 0; ts <= 1000; ts += 20) {
      t.sync(ts);
      if (ts === 0) p.cue({ patch: drift() });
      if (ts === 400) q.cue({ patch: line });
      shown.set(t.now, [p.probe(a).x, q.probe(a).x]);
    }
    t.rate = -1;
    for (let ts = 1020; ts <= 1800; ts += 20) {
      t.sync(ts);
      expect([p.probe(a).x, q.probe(a).x], `mix time ${t.now}`).toEqual(shown.get(t.now));
    }
  });

  it('is refused without history and a tape, and before the first sync', () => {
    const bare = mix<Part, Pose>(K);
    bare.sync(0);
    expect(() => {
      bare.rate = -1;
    }).toThrow(/history/);
    const untaped = mix<Part, Pose>(K, { history: { ms: 1000 } });
    untaped.sync(0);
    expect(() => untaped.ramp(-1, 100)).toThrow(/history/);
    const fresh = made();
    expect(() => {
      fresh.rate = -1;
    }).toThrow(/never synced/);
  });
});
