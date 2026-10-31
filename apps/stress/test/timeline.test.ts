import { scenarios } from '@stress/registry';
import { expect, test } from 'vitest';

const play = (name: string, size: number, frames: number, seed = 1, lanes?: boolean) => {
  const entry = scenarios[name];
  if (!entry) throw new Error(name);
  const s = entry.make({ seed, size, lanes });
  const buf = new Float64Array(s.width);
  const trace: number[][] = [];
  for (let f = 0; f < frames; f++) {
    s.step(f);
    s.read(buf);
    trace.push(Array.from(buf));
  }
  return { s, trace };
};

test('the timeline after scrubs, jumps and rate changes reads as one played straight through', () => {
  const { s } = play('timeline', 0.1, 400);
  const found = s.check();
  expect(found.filter((f) => f.kind === 'fail')).toEqual([]);
  expect(s.stats().checked).toBeGreaterThan(0);
  s.close();
});

test('the same seed plays the same bits', () => {
  const a = play('timeline', 0.1, 200, 5);
  const b = play('timeline', 0.1, 200, 5);
  expect(a.trace.every((row, f) => row.every((v, k) => Object.is(v, b.trace[f]?.[k])))).toBe(true);
  a.s.close();
  b.s.close();
});
