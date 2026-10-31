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

test('voices stay bounded, every departure resolves once, and the gone show nothing', async () => {
  const { s } = play('feed', 0.5, 600);
  const first = s.check();
  await new Promise<void>((resolve) => setTimeout(resolve));
  expect(first.filter((f) => f.kind === 'fail')).toEqual([]);
  expect(s.check().filter((f) => f.kind === 'fail')).toEqual([]);
  const stats = s.stats();
  expect(stats.pending).toBe(0);
  expect(stats.resolved).toBeGreaterThan(0);
  expect(stats.voices).toBeLessThan(1500);
  s.close();
});

test('the same seed plays the same bits', () => {
  const a = play('feed', 0.2, 200, 3);
  const b = play('feed', 0.2, 200, 3);
  expect(a.trace.every((row, f) => row.every((v, k) => Object.is(v, b.trace[f]?.[k])))).toBe(true);
  a.s.close();
  b.s.close();
});
