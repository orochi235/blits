import { describe, expect, it } from 'vitest';
import { kit, sum, type Vec, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { angle, quat } from '../src/rotation.js';

type Q = Vec<4>;

const closeAll = (a: readonly number[], b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, 9);
  });
};

/** A turn of `deg` degrees about an axis. */
const about = (axis: 0 | 1 | 2, deg: number): Q => {
  const half = (deg * Math.PI) / 360;
  const q: Q = [0, 0, 0, Math.cos(half)];
  q[axis] = Math.sin(half);
  return q;
};

/** `v` turned by `q`. */
const turn = (q: Q, v: readonly [number, number, number]): number[] => {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
};

describe('vec', () => {
  it('is a tuple of its length where the length is a literal', () => {
    interface Pose {
      position: [number, number, number];
      loose: number[];
    }
    const n: number = 2;
    const k = kit<Pose>({ position: vec(3, sum()), loose: vec(n, sum()) });
    const rest: [number, number, number] | undefined = k.position.rest;
    expect(rest).toEqual([0, 0, 0]);
    expect(k.loose.rest).toEqual([0, 0]);
  });
});

describe('angle', () => {
  it('interpolates the short way round', () => {
    const a = angle();
    expect(a.lerp(350, 10, 0.5)).toBeCloseTo(360, 9);
    expect(a.lerp(10, 350, 0.25)).toBeCloseTo(5, 9);
    expect(a.lerp(0, 90, 0.5)).toBeCloseTo(45, 9);
    const rad = angle({ turn: 2 * Math.PI });
    expect(rad.lerp(0.1, 2 * Math.PI - 0.1, 0.5)).toBeCloseTo(0, 9);
  });

  it('fades the short way to rest, and adds as sum does', () => {
    const a = angle();
    expect(a.scale?.(350, 0.5)).toBeCloseTo(-5, 9);
    expect(a.scale?.(90, 0.5)).toBeCloseTo(45, 9);
    expect(a.scale?.(90, 0)).toBeCloseTo(0, 9);
    expect(a.merge(350, 20)).toBe(370);
    expect(a.kind).toBe('angle(360)');
    expect(angle({ turn: 1 }).kind).not.toBe(a.kind);
  });

  it('refuses a turn that is not positive', () => {
    expect(() => angle({ turn: 0 })).toThrow(RangeError);
  });

  it('carries a keyed voice across the wrap in a mix', () => {
    const m = mix<string, { heading: number }>(kit({ heading: angle() }));
    m.cue({
      patch: keys(1000, [
        { at: 0, delta: { heading: 350 } },
        { at: 1, delta: { heading: 10 } },
      ]),
      start: 0,
      loop: false,
      freeze: 'after',
    });
    // A fold may answer with any angle a whole number of turns from the one meant.
    const off = (got: number, want: number) => ((((got - want) % 360) + 540) % 360) - 180;
    m.sync(250);
    expect(off(m.probe('a').heading, 355)).toBeCloseTo(0, 9);
    m.sync(750);
    expect(off(m.probe('a').heading, 5)).toBeCloseTo(0, 9);
  });
});

describe('quat', () => {
  const q = quat();
  const rest = q.rest as Q;
  const scale = q.scale as (v: Q, w: number) => Q;
  const samples: Q[] = [
    about(0, 40),
    about(1, -110),
    about(2, 170),
    q.merge(about(0, 30), about(2, 75)),
  ];

  it('rest is no rotation, and scale runs from it to the value', () => {
    expect(rest).toEqual([0, 0, 0, 1]);
    for (const v of samples) {
      closeAll(q.merge(v, rest), v);
      closeAll(q.merge(rest, v), v);
      closeAll(scale(v, 1), v);
      closeAll(scale(v, 0), rest);
    }
    closeAll(scale(about(2, 90), 0.5), about(2, 45));
  });

  it('lerp takes the short arc, whichever sign names the rotation', () => {
    const a = about(2, 10);
    const b = about(2, 50);
    const flipped = b.map((x) => -x) as Q;
    closeAll(q.lerp(a, b, 0.5), about(2, 30));
    closeAll(q.lerp(a, flipped, 0.5), about(2, 30));
    closeAll(q.lerp(a, b, 0), a);
    closeAll(q.lerp(a, b, 1), b);
    closeAll(q.lerp(a, a, 0.3), a);
  });

  it('merge composes in order, and the order matters', () => {
    const x = about(0, 90);
    const z = about(2, 90);
    closeAll(turn(q.merge(z, x), [1, 0, 0]), [0, 1, 0]);
    closeAll(turn(q.merge(x, z), [1, 0, 0]), [0, 0, 1]);
  });

  it('fold into an accumulator is merge of scale, and makes nothing new', () => {
    for (const v of samples)
      for (const w of [0, 0.25, 0.5, 1]) {
        const acc = about(1, 20);
        const want = q.merge(acc, scale(v, w));
        const into = [...acc] as Q;
        expect(q.fold?.(into, v, w)).toBe(into);
        closeAll(into, want);
      }
  });

  it('folds voices in a mix in cue order, and leaves its rest alone', () => {
    const m = mix<string, { spin: Q }>(kit({ spin: q }));
    const say = (v: Q) => patch<string, { spin: Q }>(0, () => ({ spin: v }), { writes: ['spin'] });
    m.cue({ patch: say(about(2, 90)) });
    const h = m.cue({ patch: say(about(0, 90)) });
    m.sync(0);
    closeAll(turn(m.probe('a').spin, [1, 0, 0]), [0, 1, 0]);
    h.weight = 0.5;
    m.sync(16);
    closeAll(m.probe('a').spin, q.merge(about(2, 90), about(0, 45)));
    m.sync(32);
    closeAll(m.probe('b').spin, q.merge(about(2, 90), about(0, 45)));
    expect(rest).toEqual([0, 0, 0, 1]);
  });
});
