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

test('cells settle on their last targets and the lanes agree with the general path', () => {
  const { s } = play('heatmap', 0.1, 300);
  expect(s.check().filter((f) => f.kind === 'fail')).toEqual([]);
  s.close();
});

test('the same seed plays the same bits, lanes on or off', () => {
  const on = play('heatmap', 0.05, 120, 7, true);
  const off = play('heatmap', 0.05, 120, 7, false);
  expect(on.trace.length).toBe(120);
  expect(on.trace.every((row, f) => row.every((v, k) => Object.is(v, off.trace[f]?.[k])))).toBe(
    true,
  );
  on.s.close();
  off.s.close();
});
