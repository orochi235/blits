import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mix, patch, sum } from '../src/index.js';
import { checkDriver, type DriverMixOptions } from '../src/testing.js';

const K = kit({ x: sum() });
const ramp = patch<object, { x: number }>(4000, (p) => ({ x: p }), { writes: ['x'] });

/** A driver that copies one subject's `x` out each frame, and counts owed ticks a way `by` says. */
function scene(by: 'played' | 'host', keep: 'bounded' | 'all' = 'bounded') {
  return {
    tape,
    restores: false,
    make(opts: DriverMixOptions) {
      const m = mix<object, { x: number }>(
        K,
        opts.transport ? { transport: opts.transport, name: opts.name } : opts,
      );
      const dot = {};
      m.cue({ patch: ramp, subjects: [dot], loop: true });
      let last = Number.NaN;
      let ticks = 0;
      const log: number[] = [];
      return {
        mix: m,
        frame() {
          const t = by === 'played' ? m.played : m.timestamp;
          if (!Number.isNaN(last)) ticks += Math.floor(t / 100) - Math.floor(last / 100);
          last = t;
          log.push(ticks);
          if (keep === 'bounded' && log.length > 60) log.shift();
        },
        output: () => ticks,
        size: () => log.length,
      };
    },
  };
}

describe('checkDriver', () => {
  it('passes a driver that owes by mix.played and keeps a bounded log', () => {
    expect(checkDriver(scene('played'))).toEqual([]);
  });

  it('catches a driver that keeps time by the host clock, and a log that grows', () => {
    const problems = checkDriver(scene('host', 'all'));
    expect(problems.some((p) => p.startsWith('at rate 0'))).toBe(true);
    expect(problems.some((p) => p.startsWith('after a rebase'))).toBe(true);
    expect(problems.some((p) => p.startsWith('what it keeps grew'))).toBe(true);
  });
});
