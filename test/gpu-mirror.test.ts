import { describe, expect, it } from 'vitest';
import { codesOf } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Mirror } from '../src/gpu/mirror.js';
import { motionPack } from '../src/gpu/runners/motion.js';
import { kit, mix, spring, sum } from '../src/index.js';
import { motionOf } from '../src/motion.js';
import type { Motions } from '../src/motions.js';

interface C {
  id: number;
}
interface P {
  x: number;
}
const K = kit<P>({ x: sum() });

/** A spring cued on a mix at time 0, its `Motions`, and a mirror of `list`. */
function setup(list: C[], meet: C[] = []) {
  const s = spring<C, P>('x', { to: (c) => c.id });
  const m = mix<C, P>(K, { name: 'mirror' });
  m.sync(0);
  m.cue({ patch: s, subjects: list });
  for (const c of meet) m.probe(c);
  const motions = motionOf<C>(s) as Motions<C>;
  const packed = motionPack(s, codesOf(mixerOf(m)));
  if (packed === undefined || 'why' in packed) throw new Error('the spring did not pack');
  const mirror = new Mirror(motions, list, packed.values);
  return { s, m, motions, mirror };
}

const cells = (n: number) => Array.from({ length: n }, (_, id) => ({ id }));

describe('motion mirror', () => {
  it('marks dirty exactly the rows of subjects retargeted', () => {
    const list = cells(1000);
    const { s, mirror } = setup(list);
    mirror.prepare(0, Number.POSITIVE_INFINITY);
    mirror.take();
    expect(mirror.dirtyRows()).toEqual([]);
    for (const i of [7, 412, 999]) s.to(list[i] as C, -5);
    expect(mirror.dirtyRows()).toEqual([7, 412, 999]);
    mirror.prepare(16, Number.POSITIVE_INFINITY);
    const stride = mirror.stride * 4;
    expect(mirror.take()).toEqual([7, 412, 999].map((r) => [r * stride, (r + 1) * stride]));
  });

  it('lays rows out in registration order, not the order the patch met subjects', () => {
    const list = cells(3);
    const reversed = [...list].reverse();
    const { motions, mirror } = setup(list, list);
    mirror.detach();
    const again = new Mirror(motions, reversed, mirror.values());
    again.prepare(0, Number.POSITIVE_INFINITY);
    const first = reversed[0] as C;
    const b = motions.base(motions.known(first) as number);
    const n = motions.n;
    const want = Array.from(motions.runs.subarray(b, b + motions.stride));
    want[0] = (want[0] as number) - again.anchor;
    expect(Array.from(again.rows.subarray(0, motions.stride))).toEqual(want);
    // The goal is the subject's id: row 0 heads for 2, the subject now first.
    expect(again.rows[3 + 2 * n]).toBe(first.id);
  });

  it('commits an untimed retarget no probe saw at the voice time', () => {
    const list = cells(4);
    const { s, m, motions, mirror } = setup(list);
    m.sync(100);
    s.to(list[2] as C, 50);
    const slot = motions.known(list[2] as C) as number;
    expect(motions.pending?.[slot]?.[0]?.at).toBeUndefined();
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    const b = motions.base(slot);
    expect(motions.pending?.[slot]).toBeUndefined();
    expect(motions.runs[b]).toBe(100);
    expect(mirror.rows[2 * mirror.stride]).toBe(100 - mirror.anchor);
    expect(mirror.rows[2 * mirror.stride + 3 + 2 * motions.n]).toBe(50);
  });

  it('keeps a retarget timed ahead pending until the frame reaching it', () => {
    const list = cells(4);
    const { s, motions, mirror } = setup(list);
    mirror.prepare(100, Number.POSITIVE_INFINITY);
    s.to(list[1] as C, 50, 600);
    const slot = motions.known(list[1] as C) as number;
    const b = motions.base(slot);
    for (const t of [116, 400, 599]) {
      mirror.prepare(t, Number.POSITIVE_INFINITY);
      expect(motions.pending?.[slot]?.length).toBe(1);
      expect(motions.runs[b]).toBe(0);
    }
    mirror.take();
    mirror.prepare(616, Number.POSITIVE_INFINITY);
    expect(motions.pending?.[slot]).toBeUndefined();
    expect(motions.runs[b]).toBe(600);
    expect(mirror.dirtyRows()).toEqual([1]);
    expect(mirror.rows[mirror.stride]).toBe(600 - mirror.anchor);
  });

  it('stops listening once detached', () => {
    const list = cells(2);
    const { s, motions, mirror } = setup(list);
    mirror.detach();
    expect(motions.listener).toBeNull();
    s.to(list[0] as C, 9);
    expect(mirror.stirred).toBe(false);
  });
});
