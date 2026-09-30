import { describe, expect, it } from 'vitest';
import { kit, mul, sum, vec } from '../src/channels.js';
import { curve } from '../src/easing.js';
import { mix } from '../src/mixer.js';
import { evalKeys, keys } from '../src/patch.js';
import type { Keyframe } from '../src/types.js';

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
  period: number,
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
    const ph = delay === 0 || period === 0 ? phase : Math.max(0, (phase * period - delay) / period);
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
});
