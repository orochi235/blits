import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { eligibility } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { packOf } from '../src/gpu/runner.js';
import { codeFor } from '../src/gpu/wgsl/channels.js';
import { type Channel, keys, kit, last, mix, sum, vec } from '../src/index.js';

type O = { v: number; p: number[]; s: string };
const v = sum();
const p = vec(2, sum());
const codeOf = (c: Channel<unknown>) => {
  const code = codeFor(c);
  if (code === undefined) throw new Error('no WGSL');
  return code;
};
const lookup = new Map([
  ['v', codeOf(v as Channel<unknown>)],
  ['p', codeOf(p as Channel<unknown>)],
  // A channel whose rule has WGSL to fold by but none to interpolate by.
  ['s', { axes: 1, rest: [0], fold: 'acc[0] = v[0];' }],
]);
const pack = (patch: object) => packOf(patch, lookup);

describe('packing a keys patch', () => {
  it('packs the duration, then per track its delay, stop count, and each stop', () => {
    const k = keys<unknown, O>(1000, [
      { at: 0, delta: { v: 0 } },
      { at: 0.5, delta: { v: 2 }, ease: 'ease-in' },
      { at: 1, delta: { v: 1 } },
    ]);
    const got = pack(k);
    if (got === undefined || !('values' in got))
      throw new Error(`not packed: ${JSON.stringify(got)}`);
    expect(got.values).toEqual(
      Float32Array.from([
        1000, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 0.42, 0, 1, 1, 2, 1, 0, 0, 0, 0, 0, 1,
      ]),
    );
    expect(got.runner.writes).toEqual(['v']);
  });
  it('packs tracks in writes order, each with its delay and its axes', () => {
    const k = keys<unknown, O>(
      500,
      [
        { at: 0, delta: { p: [1, 2] } },
        { at: 1, delta: { p: [3, 4], v: 5 } },
      ],
      { delayBy: (c) => (c === 'v' ? 100 : 0) },
    );
    const got = pack(k);
    if (got === undefined || !('values' in got)) throw new Error('not packed');
    expect([...got.values]).toEqual([
      500, 0, 2, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 3, 4, 100, 1, 1, 0, 0, 0, 0, 0, 5,
    ]);
  });
  it('refuses a stop eased by a function', () => {
    const k = keys<unknown, O>(1000, [
      { at: 0, delta: { v: 0 } },
      { at: 1, delta: { v: 1 }, ease: (u: number) => u * u },
    ]);
    expect(pack(k)).toEqual({ why: 'its easing is a function' });
  });
  it('refuses a stop it cannot read', () => {
    const k = keys<unknown, O>(1000, [
      { at: 0, delta: { v: 'up' as never } },
      { at: 1, delta: { v: 1 } },
    ]);
    expect(pack(k)).toEqual({ why: 'a stop holds a value the GPU cannot read' });
    const short = keys<unknown, O>(1000, [{ at: 0, delta: { p: [1] } }]);
    expect(pack(short)).toEqual({ why: 'a stop holds a value the GPU cannot read' });
  });
  it('refuses a channel the GPU cannot interpolate', () => {
    const k = keys<unknown, O>(1000, [{ at: 0, delta: { s: 1 as never } }]);
    expect(pack(k)).toEqual({ why: 'the GPU cannot interpolate s' });
  });
  it("refuses a track lerping other than by its channel's lerp", () => {
    const own = (a: number, b: number, u: number) => (u < 0.5 ? a : b);
    const k = keys<unknown, O>(1000, [{ at: 0, delta: { v: 1 } }], {
      lerpBy: () => own as never,
    });
    expect(pack(k)).toEqual({ why: 'v interpolates by its own lerp' });
    const same = keys<unknown, O>(1000, [{ at: 0, delta: { v: 1 } }], {
      lerpBy: () => v.lerp as never,
    });
    expect(pack(same)).not.toHaveProperty('why');
    const kitted = keys<unknown, O>(1000, [{ at: 0, delta: { v: 1 } }], {
      kit: { v: last() as never },
    });
    expect(pack(kitted)).toEqual({ why: 'v interpolates by its own lerp' });
  });
});

describe('a keys voice from the current pose', () => {
  it('stays on the CPU, saying why', () => {
    const k = kit<{ v: number }>({ v: sum() });
    const m = mix<object, { v: number }>(k);
    const cells = [{}];
    m.cue({
      patch: keys(1000, [{ at: 1, delta: { v: 1 } }], { kit: k }),
      subjects: cells,
      from: 'current',
    });
    m.sync(0);
    m.sync(10);
    const answers = new Answers<object>(mixerOf(m) as never);
    answers.register(cells);
    expect(eligibility(mixerOf(m), answers).reasons.map((r) => r.why)).toEqual([
      "it starts from the subject's current pose",
    ]);
  });
});
