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

  it('passes a driver putting its own calls on the tape, and catches one keeping them apart', () => {
    expect(checkDriver(kicked(true))).toEqual([]);
    const problems = checkDriver(kicked(false));
    expect(problems).toEqual([
      expect.stringMatching(/^after a seek back and a host call starting a new future/),
    ]);
  });
});

/**
 * A driver whose output is the subject's `x` and the kicks the host gave it so far, kept with the
 * frame each was given in and cut on a seek back. `taped` puts each kick on the mix's tape;
 * otherwise it keeps them only in its own log, which a seek back leaves for playing on.
 */
function kicked(taped: boolean) {
  return {
    tape,
    restores: true,
    make(opts: DriverMixOptions) {
      const m = mix<object, { x: number }>(
        K,
        opts.transport ? { transport: opts.transport, name: opts.name } : opts,
      );
      const dot = {};
      m.cue({ patch: ramp, subjects: [dot], loop: true });
      const log: { at: number; seq: number }[] = [];
      if (taped)
        m.onSeek((s) => {
          if (s.back) log.splice(0, log.length, ...log.filter((e) => e.seq <= s.frame));
        });
      const kick = () => log.push({ at: m.now, seq: m.seq });
      return {
        mix: m,
        frame() {},
        output: () => [m.probe(dot).x, log.filter((e) => e.at <= m.now).length],
        call: () => (taped ? m.call('kick', kick) : kick()),
      };
    },
  };
}
