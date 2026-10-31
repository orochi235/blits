import { kit, mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };

describe('a ramping mix rate', () => {
  it('emits rate × mix time while the mix rate ramps down', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 1000 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(0);
    q.write();
    m.ramp(0.5, 1000);
    let last = m.now;
    let mixTime = 0;
    for (let f = 1; f <= 10; f++) {
      m.sync(f * 100);
      mixTime += m.now - last;
      last = m.now;
      q.write();
    }
    expect(born(s).length).toBeCloseTo(mixTime, -1);
  });
});
