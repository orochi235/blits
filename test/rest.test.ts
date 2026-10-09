import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Channel } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const part = { id: 'a' };

const counted = () => {
  const calls = { n: 0 };
  const p = patch<Part, Pose>(
    100,
    (phase) => {
      calls.n++;
      return { crawl: 10 * phase };
    },
    { writes: ['crawl'] },
  );
  return { p, calls };
};

describe.each([true, false])('atRest after a probe, lanes %s', (lanes) => {
  it("answers from the frame's probe without calling the patch again", () => {
    const { p, calls } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.cue({ patch: p, loop: true });
    m.sync(0);
    m.atRest(part);
    for (const t of [20, 40, 60]) {
      m.sync(t);
      m.probe(part, {} as Pose);
      const before = calls.n;
      expect(m.atRest(part)).toBe(false);
      expect(calls.n).toBe(before);
    }
  });

  it('answers for the pose the probe gave, though a weight reading host input moved since', () => {
    const input = { w: 1 };
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.cue({ patch: p, loop: true, weight: () => input.w });
    m.sync(0);
    m.atRest(part);
    m.sync(50);
    m.probe(part);
    input.w = 0;
    expect(m.atRest(part)).toBe(false);
    m.sync(60);
    expect(m.atRest(part)).toBe(true);
  });

  it('folds again once a voice is cued after the probe', () => {
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.atRest(part);
    m.sync(0);
    m.probe(part);
    expect(m.atRest(part)).toBe(true);
    m.cue({ patch: p, loop: true, start: 0 });
    m.sync(0);
    expect(m.atRest(part)).toBe(true);
    m.sync(50);
    m.probe(part);
    m.cue({ patch: p, loop: true, start: 50 });
    expect(m.atRest(part)).toBe(false);
  });

  it('folds again once a voice is stopped, muted or reweighted after the probe', () => {
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    const changes: ((h: ReturnType<typeof m.cue>) => void)[] = [
      (h) => h.fade({ over: 0 }),
      () => m.mute({ over: 0 }),
      (h) => {
        h.weight = 0;
      },
    ];
    m.atRest(part);
    let t = 0;
    for (const change of changes) {
      const h = m.cue({ patch: p, loop: true });
      t += 50;
      m.sync(t);
      m.probe(part);
      expect(m.atRest(part)).toBe(false);
      change(h);
      expect(m.atRest(part)).toBe(true);
      h.fade({ over: 0 });
    }
  });
});

describe("a channel's rest", () => {
  type V = { a: number };
  class Box {
    constructor(public a: number) {}
  }
  const plain = (): Channel<V> => ({
    rest: { a: 0 },
    merge: (x, y) => ({ a: x.a + y.a }),
    scale: (v, w) => ({ a: v.a * w }),
    fold: (into, v, w) => {
      into.a += v.a * w;
      return into;
    },
    lerp: (x, y, u) => ({ a: x.a + (y.a - x.a) * u }),
  });
  const typed = (): Channel<Float32Array> => ({
    rest: new Float32Array(2),
    merge: (x, y) => x.map((v, i) => v + (y[i] as number)) as Float32Array,
    scale: (v, w) => v.map((x) => x * w) as Float32Array,
    fold: (into, v, w) => {
      for (let i = 0; i < 2; i++) into[i] = (into[i] as number) + (v[i] as number) * w;
      return into;
    },
    lerp: (x, y, u) => x.map((v, i) => v + ((y[i] as number) - v) * u) as Float32Array,
  });

  it('is never written into by a fold, across frames or subjects', () => {
    const o = plain();
    const f = typed();
    type P = { o: V; f: Float32Array };
    const m = mix<Part, P>(kit<P>({ o, f }), { lanes: false });
    m.cue({
      patch: patch<Part, P>(0, () => ({ o: { a: 1 }, f: new Float32Array([1, 1]) }), {
        writes: ['o', 'f'],
      }),
    });
    const poses: P[] = [];
    for (let t = 0; t < 3; t++) {
      m.sync(t * 16);
      poses.push(m.probe({ id: 'a' }), m.probe({ id: 'b' }));
    }
    expect(o.rest).toEqual({ a: 0 });
    expect([...(f.rest as Float32Array)]).toEqual([0, 0]);
    for (const p of poses) {
      expect(p.o).toEqual({ a: 1 });
      expect([...p.f]).toEqual([1, 1]);
    }
    expect(poses[0]?.o).not.toBe(poses[1]?.o);
  });

  it('copies through the channel when it says how', () => {
    const copies: Box[] = [];
    const box: Channel<Box> = {
      rest: new Box(0),
      copy: (v) => {
        const b = new Box(v.a);
        copies.push(b);
        return b;
      },
      merge: (x, y) => new Box(x.a + y.a),
      scale: (v, w) => new Box(v.a * w),
      fold: (into, v, w) => {
        into.a += v.a * w;
        return into;
      },
      lerp: (x, y, u) => new Box(x.a + (y.a - x.a) * u),
    };
    type P = { b: Box };
    const m = mix<Part, P>(kit<P>({ b: box }), { lanes: false });
    m.cue({ patch: patch<Part, P>(0, () => ({ b: new Box(2) }), { writes: ['b'] }) });
    m.sync(0);
    const p = m.probe(part);
    expect(p.b).toBeInstanceOf(Box);
    expect(p.b.a).toBe(2);
    expect((box.rest as Box).a).toBe(0);
    expect(copies.length).toBeGreaterThan(0);
  });

  it('refuses a cue when fold would write into an object it cannot copy', () => {
    const box: Channel<Box> = {
      rest: new Box(0),
      merge: (x, y) => new Box(x.a + y.a),
      scale: (v, w) => new Box(v.a * w),
      fold: (into) => into,
      lerp: (x) => x,
    };
    type P = { b: Box };
    const m = mix<Part, P>(kit<P>({ b: box }));
    expect(() =>
      m.cue({ patch: patch<Part, P>(0, () => ({ b: new Box(2) }), { writes: ['b'] }) }),
    ).toThrow(/copy/);
  });
});
