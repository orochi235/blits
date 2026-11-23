import { describe, expect, it } from 'vitest';
import { diverge, type OpsOptions } from './fuzz/ops.js';

const SWEEPS: { name: string; options: OpsOptions; seeds: number }[] = [
  { name: 'ops between frames', options: {}, seeds: 1000 },
  { name: 'ops between probes', options: { mid: true }, seeds: 1000 },
  { name: 'with history', options: { hist: true }, seeds: 300 },
  { name: 'between probes, with history', options: { mid: true, hist: true }, seeds: 300 },
];

describe('lanes on and off read the same under random host ops', () => {
  for (const { name, options, seeds } of SWEEPS)
    it(`${name}: seeds 1..${seeds}`, () => {
      const failed: string[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const d = diverge(seed, options);
        if (d) failed.push(`seed ${seed}, reading ${d.line}\n  off: ${d.off}\n  on:  ${d.on}`);
      }
      expect(failed.slice(0, 3), 'shrink one with shrink(seed, options) in fuzz/ops.ts').toEqual(
        [],
      );
    }, 30_000);
});
