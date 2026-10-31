import { scenarios } from '@stress/registry';
import { expect, test } from 'vitest';

const play = (name: string, size: number, frames: number, seed = 1, lanes?: boolean) => {
  const entry = scenarios[name];
  if (!entry) throw new Error(name);
  const s = entry.make({ seed, size, lanes, frames });
  const buf = new Float64Array(s.width);
  const trace: number[][] = [];
  for (let f = 0; f < frames; f++) {
    s.step(f);
    s.read(buf);
    trace.push(Array.from(buf));
  }
  return { s, trace };
};

test('each bone turns and moves as its role blends the clips and the IK hold', () => {
  const { s } = play('rig', 0.2, 300);
  const found = s.check();
  expect(found.filter((x) => x.kind === 'fail')).toEqual([]);
  expect(found.filter((x) => x.kind === 'gap')).toHaveLength(1);
  const stats = s.stats();
  const during = stats.checkedDuring ?? 0;
  expect(during).toBeGreaterThan(20);
  expect(stats.checked).toBe(30 + during);
  expect(stats.threeWay).toBeGreaterThan(0);
  expect(stats.held).toBeGreaterThan(0);
  s.close();
});

test('the same seed plays the same bits, lanes on or off', () => {
  const a = play('rig', 0.2, 300, 3);
  const b = play('rig', 0.2, 300, 3, false);
  expect(a.trace.every((row, f) => row.every((v, k) => Object.is(v, b.trace[f]?.[k])))).toBe(true);
  a.s.close();
  b.s.close();
});
