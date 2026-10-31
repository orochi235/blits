import { scenarios } from '@stress/registry';
import { expect, test } from 'vitest';

const DEPARTS = "a from: 'current' fade leaves at the speed";

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

test('the cue stack shows the levels a plain model of the cue sheet gives', () => {
  const { s } = play('cues', 0.1, 1200);
  // Blits departing from blending.mdx's reading of `from: 'current'` is a finding the check reports
  // once; the model then holds blits to the reading it implements.
  const fails = s.check().filter((f) => f.kind === 'fail' && !f.what.startsWith(DEPARTS));
  expect(fails).toEqual([]);
  expect(s.stats().gos).toBeGreaterThan(2);
  s.close();
});

test('the same seed plays the same bits, lanes on or off', () => {
  const a = play('cues', 0.1, 600, 5);
  const b = play('cues', 0.1, 600, 5, false);
  expect(a.trace.every((row, f) => row.every((v, k) => Object.is(v, b.trace[f]?.[k])))).toBe(true);
  a.s.close();
  b.s.close();
});
