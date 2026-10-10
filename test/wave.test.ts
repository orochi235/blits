import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import { type WaveShape, wave, waveAt } from '../src/wave.js';

interface Bob {
  x: number;
  y: number;
}

interface Sprite {
  tint?: number;
  at: readonly number[];
  label: string;
}

const read = (p: ReturnType<typeof wave<unknown, Bob>>, phase: number) =>
  p.at(phase, {}, undefined as never);

describe('waveAt', () => {
  const quarters: Record<WaveShape, number[]> = {
    sine: [0, 1, 0, -1],
    triangle: [0, 1, 0, -1],
    saw: [0, 0.5, -1, -0.5],
    square: [1, 1, -1, -1],
  };

  for (const [shape, want] of Object.entries(quarters) as [WaveShape, number[]][])
    it(`reads ${shape} at quarter points`, () => {
      for (let k = 0; k < 4; k++) expect(waveAt(shape, k / 4)).toBeCloseTo(want[k] as number, 12);
    });

  it('repeats every whole cycle, below 0 as above it', () => {
    for (const shape of ['sine', 'triangle', 'saw', 'square'] as WaveShape[])
      for (const x of [0.1, 0.3, 0.6, 0.9]) {
        expect(waveAt(shape, x + 3)).toBeCloseTo(waveAt(shape, x), 12);
        expect(waveAt(shape, x - 2)).toBeCloseTo(waveAt(shape, x), 12);
      }
    expect(waveAt('triangle', -0.25)).toBeCloseTo(-1, 12);
    expect(waveAt('saw', -0.25)).toBeCloseTo(-0.5, 12);
    expect(waveAt('square', -0.25)).toBe(-1);
  });
});

describe('wave', () => {
  it('scales the unit wave by each channel’s depth', () => {
    const p = wave<unknown, Bob>(1000, { depth: { x: 2, y: -5 } });
    expect(p.form).toBe('fn');
    expect(p.writes).toEqual(['x', 'y']);
    expect(read(p, 0.25).x).toBeCloseTo(2, 12);
    expect(read(p, 0.25).y).toBeCloseTo(-5, 12);
    expect(read(p, 0.75).x).toBeCloseTo(-2, 12);
  });

  it('takes a depth only for a channel holding a number', () => {
    wave<unknown, Sprite>(1000, { depth: { tint: 1 } });
    // @ts-expect-error: a vector channel cannot swing around a number.
    wave<unknown, Sprite>(1000, { depth: { at: 1 } });
    // @ts-expect-error: nor can a string channel.
    wave<unknown, Sprite>(1000, { depth: { label: 1 } });
  });

  it('writes only the channels depth names', () => {
    const p = wave<unknown, Bob>(1000, { shape: 'square', depth: { y: 3 } });
    expect(p.writes).toEqual(['y']);
    expect(read(p, 0.1)).toEqual({ y: 3 });
  });

  it('runs cycles per pass from its starting phase', () => {
    const p = wave<unknown, Bob>(1000, { shape: 'triangle', cycles: 2, depth: { x: 1 } });
    expect(read(p, 0.125).x).toBeCloseTo(1, 12);
    expect(read(p, 0.375).x).toBeCloseTo(-1, 12);
    const late = wave<unknown, Bob>(1000, { shape: 'saw', phase: 0.25, depth: { x: 4 } });
    expect(read(late, 0).x).toBeCloseTo(2, 12);
    expect(read(late, 0.5).x).toBeCloseTo(-2, 12);
    const half = wave<unknown, Bob>(1000, { cycles: 0.5, depth: { x: 1 } });
    expect(read(half, 0.5).x).toBeCloseTo(1, 12);
  });

  it('keeps the options it was built with on the patch', () => {
    const opts = { shape: 'saw' as const, cycles: 3, phase: 0.1, depth: { x: 1 } };
    const p = wave<unknown, Bob>(500, opts);
    expect(p.wave).toBe(opts);
    expect(keys<unknown, Bob>(500, [{ at: 0, delta: { x: 1 } }]).wave).toBeUndefined();
  });

  it('a copy plays by the options it carries', () => {
    const p = wave<unknown, Bob>(1000, { shape: 'square', depth: { x: 2 } });
    const longer = { ...p, duration: 4000 };
    expect(read(longer, 0.25).x).toBe(2);
    const deeper = { ...p, wave: { ...p.wave, depth: { x: 5 } } };
    expect(read(deeper, 0.25).x).toBe(5);
    expect(read(deeper, 0.75).x).toBe(-5);
    expect(read(p, 0.25).x).toBe(2);
    const m = mix<string, Bob>(kit<Bob>({ x: sum(), y: mul() }));
    m.cue({ patch: deeper, start: 0 });
    m.sync(250);
    expect(m.probe('a').x).toBe(5);
  });

  it('swings each channel around its rest in the kit it is given', () => {
    const k = kit<Bob>({ x: sum(), y: mul() });
    const p = wave<unknown, Bob>(1000, { shape: 'square', depth: { x: 2, y: 0.25 }, kit: k });
    expect(read(p, 0.1)).toEqual({ x: 2, y: 1.25 });
    expect(read(p, 0.6)).toEqual({ x: -2, y: 0.75 });
  });

  it('plays as a looping voice in a mix', () => {
    const m = mix<object, Bob>(kit({ x: sum(), y: sum() }));
    m.cue({ patch: wave<object, Bob>(1000, { depth: { x: 3 } }) });
    const subject = {};
    m.sync(0);
    m.probe(subject);
    m.sync(1125);
    expect(m.probe(subject).x).toBeCloseTo(3 * Math.sin(2 * Math.PI * 0.125), 9);
  });
});
