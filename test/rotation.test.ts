import { describe, expect, it } from 'vitest';
import { kit, lerpInto, sum, type Vec, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { angle, quat } from '../src/rotation.js';
import type { Channel } from '../src/types.js';

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

  it('lerps in place into an array it is given, and makes a new one for none', () => {
    const into = lerpInto(q as Channel<unknown>);
    expect(into).toBeDefined();
    const a = about(2, 10);
    const b = about(2, 50);
    const out = [0, 0, 0, 0];
    expect(into?.(out, a, b, 0.5)).toBe(out);
    closeAll(out, about(2, 30));
    const fresh = into?.(undefined, a, b, 0.5) as number[];
    expect(fresh).not.toBe(a);
    closeAll(fresh, about(2, 30));
    closeAll(into?.(a, a, b, 0.5) as number[], about(2, 30));
  });

  for (const lanes of [true, false])
    it(`reads a keys role of staggered quats as their slerps, frame on frame${lanes ? '' : ', lanes off'}`, () => {
      const m = mix<string, { spin: Q }>(kit({ spin: q }), { lanes });
      const turnOf = (axis: 0 | 1 | 2) =>
        keys<string, { spin: Q }>(1000, [
          { at: 0, delta: { spin: about(axis, 0) } },
          { at: 1, delta: { spin: about(axis, 120) } },
        ]);
      const subjects = ['a', 'b', 'c'];
      const stagger = (s: string) => subjects.indexOf(s) * 100;
      m.cue({ patch: turnOf(2), subjects, stagger, role: 'r', weight: 0.75 });
      m.cue({ patch: turnOf(2), subjects, stagger, role: 'r', weight: 0.25, start: 200 });
      const out = { spin: [0, 0, 0, 1] as Q };
      for (let t = 300; t <= 900; t += 100) {
        m.sync(t);
        for (const s of subjects) {
          const e = t - stagger(s);
          const first = about(2, (120 * e) / 1000);
          const second = about(2, (120 * Math.max(0, e - 200)) / 1000);
          closeAll(m.probe(s, out).spin, q.lerp(first, second, 0.25));
        }
      }
    });
});

describe.each([true, false])('a retarget from a turning subject, lanes %s', (lanes) => {
  const wrap = (d: number) => d - 360 * Math.round(d / 360);
  const degOf = (v: unknown) => {
    const q = v as number[];
    return (2 * Math.atan2(q[2] as number, q[3] as number) * 180) / Math.PI;
  };
  type P = { r: unknown };
  // Spins at 0.2°/ms from `base`, then takes over from where it is to 20° on, over 500 ms.
  const takeover = (
    channel: Channel<unknown>,
    as: (deg: number) => unknown,
    read: (v: unknown) => number,
    base: number,
  ): number[] => {
    const m = mix<string, P>(kit<P>({ r: channel as never }), { lanes });
    const spin = m.cue({
      patch: patch<string, P>(0, () => ({ r: as(base + 0.2 * m.now) }), { writes: ['r'] }),
      role: 'r',
    });
    let t = 0;
    for (; t <= 144; t += 16) {
      m.sync(t);
      m.probe('a');
    }
    const start = read(m.probe('a').r);
    spin.weight = 0;
    m.cue({
      patch: keys<string, P>(500, [{ at: 1, delta: { r: as(base + 0.2 * 144 + 20) } }], {
        ease: 'linear',
      }),
      from: 'current',
      role: 'r',
    });
    const rel: number[] = [];
    for (; t <= 144 + 512; t += 64) {
      m.sync(t);
      rel.push(wrap(read(m.probe('a').r) - start));
    }
    return rel;
  };
  // From 53° nothing crosses 180°; from 153° the subject crosses it just before the takeover, and
  // from 160° the stop is written past it, in the next turn.
  it.each([
    ['an angle', angle() as Channel<unknown>, (d: number) => d, (v: unknown) => v as number],
    ['a quat', quat() as Channel<unknown>, (d: number) => about(2, d), degOf],
  ])('takes over %s across 180° as it does away from it', (_, channel, as, read) => {
    const plain = takeover(channel, as, read, 53);
    for (const d of plain) expect(Math.abs(d)).toBeLessThan(25);
    for (const base of [153, 160]) {
      const crossing = takeover(channel, as, read, base);
      crossing.forEach((d, i) => {
        expect(d, `from ${base}, read ${i}`).toBeCloseTo(plain[i] as number, 6);
      });
    }
  });

  it('reads the ends of a lerp of its own that goes the short way round', () => {
    const lerp = (a: number, b: number, u: number) => a + wrap(b - a) * u;
    const channel = { ...angle(), lerp } as Channel<unknown>;
    const same = (d: number) => d;
    const plain = takeover(channel, same, same as (v: unknown) => number, 53);
    // From 160° the stop is written past 180°, in the next turn.
    takeover(channel, same, same as (v: unknown) => number, 160).forEach((d, i) => {
      expect(d, `read ${i}`).toBeCloseTo(plain[i] as number, 6);
    });
  });
});

describe.each([true, false])(
  'a retarget on a channel whose lerp keeps its ends, lanes %s',
  (lanes) => {
    it('calls the lerp once per read of the first segment', () => {
      type P = { at: number[] };
      const base = vec(2, sum()) as Channel<number[]>;
      const by = base.lerp as NonNullable<Channel<number[]>['lerp']>;
      let calls = 0;
      const channel: Channel<number[]> = {
        ...base,
        lerp: (a, b, u) => {
          calls++;
          return by(a, b, u);
        },
      };
      const m = mix<string, P>(kit<P>({ at: channel }), { lanes });
      const run = m.cue({
        patch: patch<string, P>(0, () => ({ at: [0.1 * m.now, 0] }), { writes: ['at'] }),
        role: 'at',
      });
      let t = 0;
      for (; t <= 48; t += 16) {
        m.sync(t);
        m.probe('a');
      }
      run.weight = 0;
      m.cue({
        patch: keys<string, P>(500, [{ at: 1, delta: { at: [20, 5] } }]),
        from: 'current',
        role: 'at',
      });
      m.sync(t);
      m.probe('a');
      calls = 0;
      m.sync(t + 16);
      m.probe('a');
      expect(calls).toBe(1);
    });
  },
);
