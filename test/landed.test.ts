import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}

describe("a handle's landed", () => {
  it('turns true once a spring lands on 1 in a sum kit, where the mix is not at rest', () => {
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: spring<Part, Pose>('x', { from: 0, to: 1 }) });
    const a = { id: 'a' };
    let t = 0;
    for (; t < 5000; t += 16) {
      m.sync(t);
      m.probe(a);
      if (h.landed) break;
    }
    expect(h.landed).toBe(true);
    expect(t).toBeGreaterThan(100);
    expect(m.probe(a).x).toBe(1);
    expect(m.atRest(a)).toBe(false);
    expect(h.state).toBe('live');
  });

  it('turns false again when the spring is sent somewhere else, and true once there', () => {
    const s = spring<Part, Pose>('x', { from: 0, to: 1 });
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: s });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(5000);
    m.probe(a);
    expect(h.landed).toBe(true);
    h.to(a, 3);
    expect(h.landed).toBe(false);
    m.sync(5016);
    m.probe(a);
    expect(h.landed).toBe(false);
    m.sync(10_000);
    m.probe(a);
    expect(h.landed).toBe(true);
  });

  it('waits on every subject the voice reaches', () => {
    const m = mix<Part, Pose>(K);
    const h = m.cue({
      patch: glide<Part, Pose>('x', { from: 0, velocity: (s) => (s.id === 'a' ? 0 : 500) }),
    });
    const a = { id: 'a' };
    const b = { id: 'b' };
    m.sync(0);
    m.probe(a);
    m.probe(b);
    m.sync(100);
    m.probe(a);
    m.probe(b);
    expect(h.landed).toBe(false);
    m.sync(20_000);
    m.probe(a);
    m.probe(b);
    expect(h.landed).toBe(true);
  });

  it('is false for a voice playing no motion, and once done', () => {
    const m = mix<Part, Pose>(K);
    const plain = m.cue({ patch: patch<Part, Pose>(100, () => ({ x: 1 }), { writes: ['x'] }) });
    const h = m.cue({ patch: spring<Part, Pose>('x', { to: 0 }) });
    const a = { id: 'a' };
    m.sync(0);
    m.probe(a);
    m.sync(16);
    m.probe(a);
    expect(plain.landed).toBe(false);
    expect(h.landed).toBe(true);
    h.fade({ over: 0 });
    m.sync(32);
    m.probe(a);
    expect(h.state).toBe('done');
    expect(h.landed).toBe(false);
  });
});

describe("settleBy: 'length'", () => {
  // The same spring with no settle, read for where it really is at each frame.
  const exact = { from: [0, 0], to: [1, 1], stiffness: 120, damping: 14, settle: 0 };

  it('lands once the distance left and the speed, each as one length, are within settle', () => {
    const settle = 0.01;
    for (const settleBy of ['axis', 'length'] as const) {
      const m = mix<Part, Pose>(K);
      const s = spring<Part, Pose, number[]>('p', { ...exact, settle, settleBy });
      const h = m.cue({ patch: s });
      const mr = mix<Part, Pose>(K);
      const ref = spring<Part, Pose, number[]>('p', exact);
      mr.cue({ patch: ref });
      const a = { id: 'a' };
      let landedAt = Number.NaN;
      let wantAt = Number.NaN;
      for (let t = 0; t < 5000 && Number.isNaN(landedAt); t += 4) {
        m.sync(t);
        m.probe(a);
        mr.sync(t);
        mr.probe(a);
        const r = ref.read(a) as { value: number[]; velocity: number[] };
        const far = r.value.map((x) => x - 1);
        const fast = r.velocity;
        const within =
          settleBy === 'length'
            ? Math.hypot(...far) <= settle && Math.hypot(...fast) <= settle
            : [...far, ...fast].every((d) => Math.abs(d) <= settle);
        if (within && Number.isNaN(wantAt)) wantAt = t;
        if (h.landed) landedAt = t;
      }
      expect(landedAt).toBe(wantAt);
    }
  });

  it('lands later than per axis on two axes moving alike', () => {
    const at = (settleBy: 'axis' | 'length') => {
      const m = mix<Part, Pose>(K);
      const h = m.cue({
        patch: spring<Part, Pose, number[]>('p', { ...exact, settle: 0.01, settleBy }),
      });
      const a = { id: 'a' };
      for (let t = 0; t < 5000; t += 1) {
        m.sync(t);
        m.probe(a);
        if (h.landed) return t;
      }
      return Number.NaN;
    };
    expect(at('length')).toBeGreaterThan(at('axis'));
  });

  it("stops a drift's start by its speed as one length", () => {
    const read = (settleBy: 'axis' | 'length') => {
      const s = spring<Part, Pose, number[]>('p', {
        from: [0, 0],
        to: [0, 0],
        velocity: [8e-5, 8e-5],
        stiffness: 0,
        damping: 0,
        settle: 1e-4,
        settleBy,
      });
      const m = mix<Part, Pose>(K);
      m.cue({ patch: s });
      const a = { id: 'a' };
      m.sync(0);
      m.probe(a);
      return (s.read(a) as { velocity: number[] }).velocity;
    };
    expect(read('axis')).toEqual([0, 0]);
    expect(read('length')).toEqual([8e-5, 8e-5]);
  });

  it('says so in its spec, and refuses a measure it does not know', () => {
    const s = spring<Part, Pose>('x', { to: 0, settleBy: 'length' });
    expect(s.motion).toMatchObject({ kind: 'spring', settleBy: 'length' });
    expect(spring<Part, Pose>('x', { to: 0 }).motion).not.toHaveProperty('settleBy');
    expect(() =>
      spring<Part, Pose>('x', { to: 0, settleBy: 'norm' as unknown as 'length' }),
    ).toThrow(RangeError);
  });
});
