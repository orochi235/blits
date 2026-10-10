import { describe, expect, it } from 'vitest';
import { kit, last, mul, sum, vec } from '../src/channels.js';
import { mixHex } from '../src/color.js';
import { curve } from '../src/easing.js';
import { mix } from '../src/mixer.js';
import { evalKeys, keys, patch } from '../src/patch.js';
import type { Channel, Keyframe } from '../src/types.js';

interface Pose {
  a: number;
  b: number;
  p: number[];
}

/** The evaluator as it stood before stops were built ahead of time: a sort on every read. */
function reference(
  stops: readonly Keyframe<Pose>[],
  writes: readonly (keyof Pose)[],
  phase: number,
  duration: number,
  opts: {
    ease?: (u: number) => number;
    easeBy?: (c: keyof Pose) => ((u: number) => number) | undefined;
    delayBy?: (c: keyof Pose) => number;
  },
  base?: Partial<Pose>,
): Partial<Pose> {
  const lerp = (x: unknown, y: unknown, u: number): unknown =>
    typeof x === 'number' && typeof y === 'number'
      ? x + (y - x) * u
      : Array.isArray(x) && Array.isArray(y)
        ? x.map((v, i) => lerp(v, y[i], u))
        : u < 0.5
          ? x
          : y;
  const out: Record<string, unknown> = {};
  for (const channel of writes) {
    const delay = opts.delayBy?.(channel) ?? 0;
    const ph =
      delay === 0 || duration === 0
        ? phase
        : delay >= duration
          ? phase >= 1
            ? 1
            : 0
          : Math.max(0, (phase * duration - delay) / (duration - delay));
    const held: { at: number; value: unknown; ease?: (u: number) => number }[] = [];
    if (base?.[channel] !== undefined) held.push({ at: 0, value: base[channel] });
    for (const stop of stops) {
      const value = stop.delta[channel];
      if (value === undefined) continue;
      if (base?.[channel] !== undefined && stop.at === 0) continue;
      held.push({ at: stop.at, value, ease: stop.ease as ((u: number) => number) | undefined });
    }
    if (held.length === 0) continue;
    held.sort((x, y) => x.at - y.at);
    const first = held[0] as (typeof held)[number];
    const last = held[held.length - 1] as (typeof held)[number];
    if (ph <= first.at) out[channel] = first.value;
    else if (ph >= last.at) out[channel] = last.value;
    else
      for (let i = 0; i < held.length - 1; i++) {
        const x = held[i] as (typeof held)[number];
        const y = held[i + 1] as (typeof held)[number];
        if (ph < x.at || ph > y.at) continue;
        const span = y.at - x.at;
        const u = span === 0 ? 1 : (ph - x.at) / span;
        const ease = y.ease ?? opts.easeBy?.(channel) ?? opts.ease;
        out[channel] = lerp(x.value, y.value, ease ? ease(u) : u);
        break;
      }
  }
  return out as Partial<Pose>;
}

function* random(seed: number): Generator<number> {
  let s = seed;
  for (;;) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    yield s / 0x7fffffff;
  }
}

const square = (u: number) => u * u;
const root = (u: number) => Math.sqrt(u);

describe('keys', () => {
  it('reads every channel as the sorting evaluator did, across random stops', () => {
    const r = random(7);
    const next = () => r.next().value as number;
    for (let trial = 0; trial < 200; trial++) {
      const stops: Keyframe<Pose>[] = [];
      const count = 1 + Math.floor(next() * 6);
      for (let s = 0; s < count; s++) {
        const delta: Partial<Pose> = {};
        if (next() < 0.7) delta.a = next() * 10;
        if (next() < 0.5) delta.b = next() * 10;
        if (next() < 0.4) delta.p = [next(), next(), next()];
        const at = next() < 0.2 ? 0 : next() < 0.1 ? 1 : Math.round(next() * 8) / 8;
        stops.push({ at, delta, ease: next() < 0.3 ? square : undefined });
      }
      const opts = {
        ease: next() < 0.5 ? root : undefined,
        easeBy: next() < 0.3 ? (c: keyof Pose) => (c === 'b' ? square : undefined) : undefined,
        delayBy: next() < 0.3 ? (c: keyof Pose) => (c === 'a' ? 120 : 0) : undefined,
      };
      const p = keys<unknown, Pose>(500, stops, opts);
      const base = next() < 0.5 ? { a: -3, p: [9, 9, 9] } : undefined;
      for (let k = 0; k <= 16; k++) {
        const phase = k / 16;
        const want = reference(stops, p.writes, phase, 500, opts, base);
        expect(evalKeys(stops, p.writes, phase, 500, opts, base)).toEqual(want);
        if (base === undefined) expect(p.at(phase, {}, undefined as never)).toEqual(want);
      }
    }
  });

  it('takes an easing as data: names, a bezier, and steps', () => {
    expect(curve('linear')(0.3)).toBe(0.3);
    expect(curve('ease-in-out')(0.5)).toBeCloseTo(0.5, 6);
    expect(curve({ bezier: [0, 0, 1, 1] })(0.37)).toBeCloseTo(0.37, 6);
    expect(curve('ease')(0.25)).toBeCloseTo(0.4085, 3);
    expect(curve({ steps: 4 })(0.3)).toBe(0.25);
    expect(curve({ steps: 4, jump: 'start' })(0.3)).toBe(0.5);
    expect(curve({ steps: 4 })(1)).toBe(1);
    const p = keys<unknown, Pose>(
      100,
      [
        { at: 0, delta: { a: 0 } },
        { at: 1, delta: { a: 10 }, ease: { steps: 2 } },
      ],
      {},
    );
    expect(p.at(0.4, {}, undefined as never).a).toBe(0);
    expect(p.at(0.6, {}, undefined as never).a).toBe(5);
  });

  it('a fold writes into nothing it was handed: stops, deltas and returned poses stay as they were', () => {
    const stops: Keyframe<Pose>[] = [
      { at: 0, delta: { p: [1, 2, 3] } },
      { at: 0.5, delta: { p: [4, 5, 6] } },
      { at: 1, delta: { p: [1, 2, 3] } },
    ];
    const frozen = JSON.stringify(stops);
    const m = mix<object, Pose>(kit({ a: sum(), b: mul(), p: vec(3, sum()) }));
    m.cue({ patch: keys<object, Pose>(100, stops), weight: 0.5 });
    m.cue({ patch: keys<object, Pose>(100, stops), start: 30 });
    const subject = {};
    const out = {} as Pose;
    const seen: number[][] = [];
    for (let t = 0; t <= 300; t += 10) {
      m.sync(t);
      const pose = m.probe(subject, out);
      seen.push([...pose.p]);
      const held = pose.p;
      m.probe({}, out);
      expect(held).toEqual(seen[seen.length - 1]);
    }
    expect(JSON.stringify(stops)).toBe(frozen);
  });

  it('a keyed array read into a reused array never reaches a stop, a held pose or another reader', () => {
    interface Rig {
      a: number;
      p: number[];
      q: number[];
    }
    const freeze = (stops: Keyframe<Rig>[]): Keyframe<Rig>[] => {
      for (const stop of stops) {
        for (const v of Object.values(stop.delta)) Object.freeze(v);
        Object.freeze(stop.delta);
        Object.freeze(stop);
      }
      return Object.freeze(stops) as Keyframe<Rig>[];
    };
    const loop = freeze([
      { at: 0, delta: { a: 0, p: [1, 2, 3], q: [0, 0, 0] } },
      { at: 0.5, delta: { a: 4, p: [4, -5, 6], q: [2, 4, 8] }, ease: 'ease-in' },
      { at: 1, delta: { a: 0, p: [1, 2, 3], q: [0, 0, 0] } },
    ]);
    const retarget = freeze([
      { at: 0.5, delta: { p: [9, 9, 9] } },
      { at: 1, delta: { p: [0, 1, 0] } },
    ]);
    const frozen = JSON.stringify([loop, retarget]);
    const stock: Channel<number[]> = vec(3, sum());
    // Borrows vec's lerp, but its merge hands the contribution itself to the pose, so a read must not
    // reuse that array.
    const stockLast: Channel<number[]> = { lerp: stock.lerp, merge: (_a, b) => b };
    // The same arithmetic through lerps with no in-place form, which allocate as reads used to.
    const lerp = (a: number[], b: number[], u: number) => stock.lerp(a, b, u);
    const run = (fresh: boolean) => {
      const m = mix<{ id: number }, Rig>(
        kit<Rig>({
          a: sum(),
          p: fresh ? { ...stock, lerp } : stock,
          q: fresh ? { ...stockLast, lerp } : stockLast,
        }),
        { history: { ms: 2000 } },
      );
      const shared = keys<{ id: number }, Rig>(1000, loop);
      m.cue({ patch: shared, stagger: (s) => s.id * 130 });
      m.cue({ patch: shared, start: 250, weight: 0.75 });
      const subjects = [{ id: 0 }, { id: 1 }];
      const out = {} as Rig;
      const frames: unknown[] = [];
      const kept: { pose: Rig; was: Rig }[] = [];
      for (let t = 0; t <= 2000; t += 25) {
        if (t === 400)
          m.cue({ patch: keys<{ id: number }, Rig>(600, retarget), from: 'current', loop: false });
        m.sync(t);
        for (const s of subjects) {
          frames.push(structuredClone(m.probe(s, out)));
          const pose = m.probe(s);
          kept.push({ pose, was: structuredClone(pose) });
          frames.push(m.atRest(s));
          frames.push(structuredClone(m.project(t + 300).probe(s)));
          if (t >= 100) frames.push(structuredClone(m.project(t - 100).probe(s)));
        }
        // A repeat probe in the same frame hands back each subject's delta from earlier.
        for (const s of subjects) frames.push(structuredClone(m.probe(s)));
      }
      for (const { pose, was } of kept) expect(pose).toEqual(was);
      return frames;
    };
    expect(run(false)).toEqual(run(true));
    expect(JSON.stringify([loop, retarget])).toBe(frozen);
  });
});

describe('keyed stops interpolate through the channel', () => {
  interface Lit {
    color: number;
    angle: number;
  }
  // Takes the short way round: 0.1 and 2π − 0.1 meet at 0, not at π.
  const wrapped: Channel<number> = {
    merge: (_a, b) => b,
    lerp: (a, b, u) => {
      let d = (b - a) % (2 * Math.PI);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      return a + d * u;
    },
  };
  const LIT = kit<Lit>({ color: last<number>({ lerp: mixHex }), angle: wrapped });
  const subject = { id: 'a' };

  it("reads a keyed color through the mix's hex lerp, not as a packed integer", () => {
    const m = mix<{ id: string }, Lit>(LIT);
    m.cue({
      patch: keys<{ id: string }, Lit>(100, [
        { at: 0, delta: { color: 0xff0000 } },
        { at: 1, delta: { color: 0x0000ff } },
      ]),
      loop: false,
    });
    m.sync(0);
    m.probe(subject);
    m.sync(50);
    expect(m.probe(subject).color).toBe(mixHex(0xff0000, 0x0000ff, 0.5));
  });

  it("retargets from the current value through the channel's lerp", () => {
    const m = mix<{ id: string }, Lit>(LIT);
    m.cue({
      patch: keys<{ id: string }, Lit>(0, [{ at: 0, delta: { angle: 2 * Math.PI - 0.1 } }]),
    });
    m.sync(0);
    m.probe(subject);
    m.cue({
      patch: keys<{ id: string }, Lit>(100, [{ at: 1, delta: { angle: 0.1 } }]),
      from: 'current',
      loop: false,
    });
    m.sync(50);
    expect(m.probe(subject).angle).toBeCloseTo(2 * Math.PI, 9);
  });

  it('a lerpBy the patch names wins over the channel', () => {
    const m = mix<{ id: string }, Lit>(LIT);
    m.cue({
      patch: keys<{ id: string }, Lit>(
        100,
        [
          { at: 0, delta: { angle: 0 } },
          { at: 1, delta: { angle: 1 } },
        ],
        { lerpBy: () => (_a: never, b: never) => b },
      ),
      loop: false,
    });
    m.sync(0);
    m.probe(subject);
    m.sync(50);
    expect(m.probe(subject).angle).toBe(1);
  });

  it('read outside a mix, uses the kit the patch names', () => {
    const p = keys<{ id: string }, Lit>(
      100,
      [
        { at: 0, delta: { color: 0xff0000 } },
        { at: 1, delta: { color: 0x0000ff } },
      ],
      { kit: { color: last<number>({ lerp: mixHex }) } },
    );
    expect(p.at(0.5, subject, undefined as never).color).toBe(mixHex(0xff0000, 0x0000ff, 0.5));
  });
});

describe('a retarget from the current pose under an easing with no starting slope', () => {
  type P = { x: number };
  const K1 = kit<P>({ x: sum() });
  const s = { id: 1 };
  it.each([
    [{ steps: 4, jump: 'start' } as const],
    [{ bezier: [0, 1, 0, 1] } as const],
    [{ steps: 4 } as const],
    ['linear' as const],
  ])('stays between where it was and where it goes, with %j', (ease) => {
    const m = mix<typeof s, P>(K1, { lanes: false });
    const mover = m.cue({
      patch: patch<typeof s, P>(10_000, (ph) => ({ x: ph * 10_000 }), { writes: ['x'] }),
    });
    for (let t = 0; t <= 32; t += 16) {
      m.sync(t);
      m.probe(s);
    }
    mover.fade({ over: 0 });
    m.cue({
      patch: keys<typeof s, P>(1000, [{ at: 1, delta: { x: 100 } }], { ease }),
      from: 'current',
      loop: false,
      freeze: 'after',
    });
    for (const dt of [16, 100, 250, 500, 1000]) {
      m.sync(32 + dt);
      const x = m.probe(s).x;
      expect(x).toBeGreaterThan(-50);
      expect(x).toBeLessThan(250);
    }
  });
});

describe.each([true, false])('a channel given a delay, lanes %s', (lanes) => {
  it('waits, then travels in the time left and lands with the rest', () => {
    type P = { x: number; y: number };
    const m = mix<{ id: number }, P>(kit<P>({ x: sum(), y: sum() }), { lanes });
    m.cue({
      patch: keys<{ id: number }, P>(
        1000,
        [
          { at: 0, delta: { x: 0, y: 0 } },
          { at: 1, delta: { x: 100, y: 100 } },
        ],
        { delayBy: (c) => (c === 'x' ? 200 : 0) },
      ),
      loop: false,
      freeze: 'after',
    });
    const s = { id: 1 };
    m.sync(0);
    m.probe(s);
    m.sync(200);
    expect(m.probe(s).x).toBeCloseTo(0);
    m.sync(600);
    expect(m.probe(s).x).toBeCloseTo(50);
    m.sync(1000);
    expect(m.probe(s)).toEqual({ x: 100, y: 100 });
    m.sync(1500);
    expect(m.probe(s)).toEqual({ x: 100, y: 100 });
  });
});

describe.each([true, false])('a copy of a keys patch, lanes %s', (lanes) => {
  type P = { x: number; y: number };
  const s = { id: 1 };
  const made = keys<typeof s, P>(
    1000,
    [
      { at: 0, delta: { x: 0, y: 0 } },
      { at: 1, delta: { x: 100, y: 100 } },
    ],
    { ease: 'ease-in', delayBy: (c) => (c === 'x' ? 200 : 0) },
  );
  const at = (p: typeof made, t: number): P => {
    const m = mix<typeof s, P>(kit<P>({ x: sum(), y: sum() }), { lanes });
    m.cue({ patch: p, start: 0, loop: false, freeze: 'after' });
    m.sync(t);
    return m.probe(s);
  };
  const alone = (p: typeof made, phase: number) => p.at(phase, s, undefined as never);

  it('carries its options as fields, and only those it was given', () => {
    expect(made.ease).toBe('ease-in');
    expect(made.delayBy?.('x')).toBe(200);
    expect('easeBy' in made).toBe(false);
    expect('ease' in keys<typeof s, P>(1000, [{ at: 0, delta: { x: 0 } }])).toBe(false);
  });

  it('keeps its easing and delay under a new duration', () => {
    const long = { ...made, duration: 2000 };
    const want = keys<typeof s, P>(2000, made.keys ?? [], {
      ease: 'ease-in',
      delayBy: (c) => (c === 'x' ? 200 : 0),
    });
    for (const t of [100, 600, 1100, 1900]) {
      expect(at(long, t)).toEqual(at(want, t));
      expect(alone(long, t / 2000)).toEqual(alone(want, t / 2000));
    }
    expect(at(long, 1000).y).toBeLessThan(40);
  });

  it('plays by a field the copy changed', () => {
    const straight = { ...made, ease: 'linear' as const, delayBy: undefined };
    expect(at(straight, 500)).toEqual({ x: 50, y: 50 });
    expect(alone(straight, 0.5)).toEqual({ x: 50, y: 50 });
    expect(at(made, 500).y).toBeLessThan(40);
  });
});
