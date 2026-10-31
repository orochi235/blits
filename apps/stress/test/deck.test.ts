import { scenarios } from '@stress/registry';
import { expect, test } from 'vitest';

const play = async (name: string, size: number, frames: number, seed = 1, lanes?: boolean) => {
  const entry = scenarios[name];
  if (!entry) throw new Error(name);
  const s = entry.make({ seed, size, lanes });
  const buf = new Float64Array(s.width);
  const trace: number[][] = [];
  for (let f = 0; f < frames; f++) {
    s.step(f);
    s.read(buf);
    trace.push(Array.from(buf));
    await null;
  }
  return { s, trace };
};

test('every stop of the presenter, and frames mid-build, read as a fresh deck sought straight there', async () => {
  const { s } = await play('deck', 0.25, 900);
  const found = s.check();
  expect(found.filter((f) => f.kind === 'fail')).toEqual([]);
  const stats = s.stats();
  expect(stats.checked).toBeGreaterThan(5);
  expect(stats.checkedMid).toBeGreaterThan(5);
  expect(stats.backs).toBeGreaterThan(0);
  expect(stats.mids).toBeGreaterThan(0);
  expect(stats.resolutions).toBeGreaterThan(0);
  s.close();
});

test('the same seed plays the same bits, lanes on or off', async () => {
  const a = await play('deck', 0.25, 400, 5);
  const b = await play('deck', 0.25, 400, 5, false);
  expect(a.trace.every((row, f) => row.every((v, k) => Object.is(v, b.trace[f]?.[k])))).toBe(true);
  a.s.close();
  b.s.close();
});
