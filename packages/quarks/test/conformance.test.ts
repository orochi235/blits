import { kit, mix } from '@msb235/blits';
import { checkDriver, type DriverMixOptions } from '@msb235/blits/testing';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);

it('passes checkDriver: how many particles each subject emitted, frame by frame', () => {
  const problems = checkDriver({
    tape,
    // Particles once emitted stay; a seek does not take them back.
    restores: false,
    make(opts: DriverMixOptions) {
      const m = mix<Spot, Emission>(
        K,
        opts.transport ? { transport: opts.transport, name: opts.name } : opts,
      );
      const spots: Spot[] = [{ id: 'a' }, { id: 'b' }];
      m.cue({ patch: hold({ rate: 7 }), subjects: spots });
      const q = drive(m, { kit: K });
      for (const s of spots) q.attach(s, system(), { at: [0, 0, 0], rate: 3 });
      const total = new Map<string, number>();
      return {
        mix: m,
        frame() {
          for (const [s, n] of q.write()) total.set(s.id, (total.get(s.id) ?? 0) + n);
        },
        output: () => Object.fromEntries(total),
      };
    },
  });
  expect(problems).toEqual([]);
});
