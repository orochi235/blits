import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { affine, matrix } from '../src/affine.js';
import { kit, type Vec, vec } from '../src/channels.js';
import { color, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import { angle, quat } from '../src/rotation.js';
import { shortWay } from '../src/turns.js';
import type { Patch } from '../src/types.js';

interface Pose {
  r: number;
  e: number[];
  q: number[];
  c: number[];
  m: number[];
}
interface Part {
  id: string;
}
const TURN = 2 * Math.PI;
const CH = {
  r: angle({ turn: TURN }),
  e: vec(2, angle({ turn: 360 })),
  q: quat(),
  c: color(),
  m: affine(),
};
const K = kit<Pose>(CH);
const a = { id: 'a' };

/** How far along from 0 to 1 a spring of these constants is `ms` after release at rest: RK4. */
function along(k: number, c: number, ms: number): number {
  let x = 0;
  let v = 0;
  const h = 1e-5;
  const f = (xx: number, vv: number) => -k * (xx - 1) - c * vv;
  const steps = Math.round(ms / 1000 / h);
  for (let i = 0; i < steps; i++) {
    const k1x = v;
    const k1v = f(x, v);
    const k2x = v + (h / 2) * k1v;
    const k2v = f(x + (h / 2) * k1x, v + (h / 2) * k1v);
    const k3x = v + (h / 2) * k2v;
    const k3v = f(x + (h / 2) * k2x, v + (h / 2) * k2v);
    const k4x = v + h * k3v;
    const k4v = f(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return x;
}

/** Plays `patch` on its own mix, lanes on or off, and probes `a` at each of `times`. */
function play<C extends keyof Pose>(
  patch: Patch<Part, Pose, void>,
  channel: C,
  times: readonly number[],
  lanes = true,
): Pose[C][] {
  const m = mix<Part, Pose>(K, { name: `space ${channel}`, lanes });
  m.cue({ patch });
  const out: Pose[C][] = [];
  for (const t of times) {
    m.sync(t);
    out.push(m.probe(a)[channel]);
  }
  return out;
}

const TIMES = [0, 40, 120, 250, 400, 700, 1200];
const K_ = 180;
const C_ = 12;

/** Two quaternions as one rotation: equal, or equal once one is negated. */
function sameRotation(p: readonly number[], q: readonly number[], digits = 9): void {
  const dot = p.reduce((s, x, i) => s + x * (q[i] as number), 0);
  const sign = dot < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) expect(p[i] as number).toBeCloseTo(sign * (q[i] as number), digits);
}

const near = (got: readonly number[], want: readonly number[], digits = 9) => {
  for (let i = 0; i < want.length; i++)
    expect(got[i] as number).toBeCloseTo(want[i] as number, digits);
};

describe('a motion on an angle', () => {
  it('tweens the short way across ±π, as the channel lerps', () => {
    const got = play(
      tween<Part, Pose>('r', { from: 3, to: -3, ms: 1000, ease: 'linear' }),
      'r',
      TIMES,
    );
    TIMES.forEach((t, i) => {
      const want = CH.r.lerp(3, -3, Math.min(t / 1000, 1));
      expect(shortWay((got[i] as number) - want, TURN)).toBeCloseTo(0, 12);
      expect(Math.abs(got[i] as number)).toBeGreaterThan(2.9);
    });
  });

  it('springs the short way across ±π, along the channel lerp', () => {
    const got = play(
      spring<Part, Pose>('r', { from: 3, to: -3, stiffness: K_, damping: C_, settle: 0 }),
      'r',
      TIMES,
    );
    TIMES.forEach((t, i) => {
      const want = CH.r.lerp(3, -3, along(K_, C_, t));
      expect(shortWay((got[i] as number) - want, TURN)).toBeCloseTo(0, 6);
    });
  });

  it('glides as far as it is flung, turns and all', () => {
    const got = play(
      glide<Part, Pose>('r', { from: 3, velocity: 40, ms: 500, settle: 0 }),
      'r',
      [0, 20_000],
    );
    // The pose is the angle's fold, which may answer a whole number of turns away.
    expect(shortWay((got[1] as number) - 23, TURN)).toBeCloseTo(0, 9);
    const s = glide<Part, Pose>('r', { from: 3, velocity: 40, ms: 500, settle: 0 });
    play(s, 'r', [0, 20_000]);
    expect(s.read(a)?.value).toBeCloseTo(23, 9);
  });

  it('heads the short way on each axis of a vec of angles', () => {
    const t = tween<Part, Pose, number[]>('e', {
      from: [350, 10],
      to: [10, 350],
      ms: 100,
      ease: 'linear',
    });
    const m = mix<Part, Pose>(K, { name: 'vec of angles' });
    m.cue({ patch: t });
    m.sync(0);
    m.probe(a);
    m.sync(50);
    m.probe(a);
    near(t.read(a)?.value as number[], [360, 0]);
    m.sync(100);
    m.probe(a);
    near(t.read(a)?.value as number[], [370, -10]);
  });

  it('gives the same angles to the bit on lanes and off', () => {
    const make = () =>
      spring<Part, Pose>('r', { from: 3, to: -3, stiffness: K_, damping: C_, settle: 0 });
    const on = play(make(), 'r', TIMES, true);
    const off = play(make(), 'r', TIMES, false);
    for (let i = 0; i < TIMES.length; i++) expect(Object.is(on[i], off[i])).toBe(true);
  });
});

/** A unit quaternion turning `rad` about `axis`. */
function about(axis: readonly number[], rad: number): number[] {
  const n = Math.hypot(...axis);
  const s = Math.sin(rad / 2) / n;
  return [
    (axis[0] as number) * s,
    (axis[1] as number) * s,
    (axis[2] as number) * s,
    Math.cos(rad / 2),
  ];
}
/** `a ⊗ b`. */
function times(a: readonly number[], b: readonly number[]): number[] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

describe('a motion on a quat', () => {
  const FROM = about([0, 0, 1], 0.3) as Vec<4>;
  // 170° away, and written on the far side of the sphere from FROM.
  const TO = times(FROM, about([1, 1, 0], (170 * Math.PI) / 180)).map((x) => -x) as Vec<4>;

  it('tweens along the arc the channel lerps on, staying a unit quaternion', () => {
    const got = play(
      tween<Part, Pose, number[]>('q', { from: FROM, to: TO, ms: 1000, ease: 'linear' }),
      'q',
      TIMES,
    );
    TIMES.forEach((t, i) => {
      const q = got[i] as number[];
      sameRotation(q, CH.q.lerp(FROM, TO, Math.min(t / 1000, 1)));
      expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    });
  });

  it('springs along that arc, overshooting past the target on it', () => {
    const got = play(
      spring<Part, Pose, number[]>('q', {
        from: FROM,
        to: TO,
        stiffness: K_,
        damping: C_,
        settle: 0,
      }),
      'q',
      TIMES,
    );
    TIMES.forEach((t, i) => {
      sameRotation(got[i] as number[], CH.q.lerp(FROM, TO, along(K_, C_, t)), 6);
    });
  });

  it('glides about the axis it is flung round, past a half turn', () => {
    const w = 20;
    const velocity = times(FROM, [0, 0, w / 2, 0]).map((x) => x / 1);
    const got = play(
      glide<Part, Pose, number[]>('q', { from: FROM, velocity, ms: 500, settle: 0 }),
      'q',
      [100, 30_000],
    );
    sameRotation(got[0] as number[], times(FROM, about([0, 0, 1], w * 0.5 * (1 - Math.exp(-0.2)))));
    sameRotation(got[1] as number[], times(FROM, about([0, 0, 1], w * 0.5)));
  });

  it('reads a velocity that is the rate of its value, and keeps both through a retarget', () => {
    const s = spring<Part, Pose, number[]>('q', {
      from: FROM,
      to: TO,
      stiffness: K_,
      damping: C_,
      settle: 0,
    });
    const m = mix<Part, Pose>(K, { name: 'quat retarget', history: { ms: 5000 } });
    m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    s.to(a, about([0, 1, 0], -2), 150);
    m.sync(400);
    m.probe(a);
    for (const t of [80, 150, 260]) {
      const h = 1e-4;
      const lo = s.read(a, t - h)?.value as number[];
      const hi = s.read(a, t + h)?.value as number[];
      const rate = lo.map((x, i) => ((hi[i] as number) - x) / ((2 * h) / 1000));
      near(s.read(a, t + (t === 150 ? h : 0))?.velocity as number[], rate, 3);
    }
  });
});

describe('a motion on an oklab color', () => {
  const RED = oklab(0xff0000);
  const BLUE = oklab(0x0000ff);

  it('tweens and springs along the channel lerp', () => {
    const t = play(
      tween<Part, Pose, number[]>('c', { from: RED, to: BLUE, ms: 1000, ease: 'linear' }),
      'c',
      TIMES,
    );
    const s = play(
      spring<Part, Pose, number[]>('c', {
        from: RED,
        to: BLUE,
        stiffness: K_,
        damping: C_,
        settle: 0,
      }),
      'c',
      TIMES,
    );
    TIMES.forEach((ms, i) => {
      near(t[i] as number[], CH.c.lerp(RED, BLUE, Math.min(ms / 1000, 1)), 12);
      near(s[i] as number[], CH.c.lerp(RED, BLUE, along(K_, C_, ms)), 6);
    });
  });

  it('glides in a straight line', () => {
    const v = [0.1, -0.05, 0.02, 0];
    const got = play(
      glide<Part, Pose, number[]>('c', { from: RED, velocity: v, ms: 300, settle: 0 }),
      'c',
      [20_000],
    );
    near(
      got[0] as number[],
      RED.map((x, i) => x + (v[i] as number) * 0.3),
    );
  });
});

describe('a motion on an affine', () => {
  const FROM = matrix({ x: 10, rotate: 3, scaleX: 0.5 });
  const TO = matrix({ y: -40, rotate: -3, scaleX: 2, skew: 0.2 });

  it('tweens and springs by parts, as the channel lerps', () => {
    const t = play(
      tween<Part, Pose, number[]>('m', { from: FROM, to: TO, ms: 1000, ease: 'linear' }),
      'm',
      TIMES,
    );
    const s = play(
      spring<Part, Pose, number[]>('m', {
        from: FROM,
        to: TO,
        stiffness: K_,
        damping: C_,
        settle: 0,
      }),
      'm',
      TIMES,
    );
    TIMES.forEach((ms, i) => {
      near(t[i] as number[], CH.m.lerp(FROM, TO, Math.min(ms / 1000, 1)), 9);
      near(s[i] as number[], CH.m.lerp(FROM, TO, along(K_, C_, ms)), 6);
    });
  });

  it('reads a velocity that is the rate of its value, and keeps both through a push', () => {
    const s = spring<Part, Pose, number[]>('m', { from: FROM, to: TO, stiffness: K_, damping: C_ });
    const m = mix<Part, Pose>(K, { name: 'affine push', history: { ms: 5000 } });
    m.cue({ patch: s });
    m.sync(0);
    m.probe(a);
    s.push(a, [1, -2, 0.5, 3, 40, -10], 150);
    m.sync(400);
    m.probe(a);
    for (const t of [80, 260]) {
      const h = 1e-4;
      const lo = s.read(a, t - h)?.value as number[];
      const hi = s.read(a, t + h)?.value as number[];
      const rate = lo.map((x, i) => ((hi[i] as number) - x) / ((2 * h) / 1000));
      near(s.read(a, t)?.velocity as number[], rate, 3);
    }
    near(s.read(a, 150 + 1e-6)?.value as number[], s.read(a, 150 - 1e-6)?.value as number[], 4);
    near(s.read(a, 150)?.velocity as number[], [1, -2, 0.5, 3, 40, -10], 9);
  });
});

describe('a motion in a space', () => {
  it('plays the same live, projected and sought', () => {
    const s = spring<Part, Pose, number[]>('q', {
      from: about([0, 0, 1], 0.3),
      to: about([1, 0, 0], 2.5),
      stiffness: K_,
      damping: C_,
    });
    const m = mix<Part, Pose>(K, { name: 'quat seek', history: { ms: 5000, tape } });
    m.cue({ patch: s });
    const live = new Map<number, number[]>();
    for (let t = 0; t <= 800; t += 16) {
      if (t === 160) s.to(a, about([0, 1, 0], -2.5));
      if (t === 320) s.push(a, [0.5, 0, 0, 0]);
      m.sync(t);
      live.set(t, m.probe(a).q);
    }
    m.seek(48);
    for (const t of [96, 208, 400, 800]) expect(m.project(t).probe(a).q).toEqual(live.get(t));
    m.seek(400);
    expect(m.probe(a).q).toEqual(live.get(400));
  });

  it('refuses bounds on a glide over a quat or an affine', () => {
    const m = mix<Part, Pose>(K, { name: 'bounds' });
    for (const ch of ['q', 'm'] as const) {
      const n = ch === 'q' ? 4 : 6;
      const g = glide<Part, Pose, number[]>(ch, {
        from: new Array(n).fill(0),
        bounds: [new Array(n).fill(-1), new Array(n).fill(1)],
      });
      expect(() => m.cue({ patch: g })).toThrow(/bounds/);
    }
  });
});
