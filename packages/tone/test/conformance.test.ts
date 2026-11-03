import { keys, kit, mix, sum } from '@msb235/blits';
import { checkDriver, type DriverMixOptions } from '@msb235/blits/testing';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import type { Target } from '../src/index.js';
import { drive } from './audio.js';

const K = kit({ x: sum() });

it('passes checkDriver: the values each write schedules ahead', () => {
  const problems = checkDriver({
    tape,
    // A seek back cancels what was scheduled and writes the mix's values again.
    restores: true,
    make(opts: DriverMixOptions) {
      const m = mix<string, { x: number }>(
        K,
        opts.transport ? { transport: opts.transport, name: opts.name } : opts,
      );
      m.cue({
        patch: keys<string, { x: number }>(1500, [
          { at: 0, delta: { x: 0 } },
          { at: 0.5, delta: { x: 300 }, easing: 'ease-in-out' },
          { at: 1, delta: { x: 0 } },
        ]),
        subjects: ['a'],
        loop: true,
      });
      // Rounded past hearing: host time in seconds rounds apart by 1e-12 across a rebase.
      const audible = (v: number) => Math.round(v * 1000) / 1000 + 0;
      let written: number[] = [];
      const target: Target = {
        cancelAndHoldAtTime: () => {},
        linearRampToValueAtTime: (value) => written.push(audible(value)),
        setValueAtTime: (value) => written.push(audible(value)),
      };
      // The audio clock follows the host's, as a page's AudioContext does.
      const clock = () => (Number.isNaN(m.timestamp) ? 0 : m.timestamp / 1000);
      const d = drive(m, { clock, ahead: 50, grid: 25 });
      d.attach('a', { x: target });
      let out: number[] = [];
      return {
        mix: m,
        frame() {
          written = [];
          d.write();
          out = written;
        },
        output: () => out,
      };
    },
  });
  expect(problems).toEqual([]);
});
