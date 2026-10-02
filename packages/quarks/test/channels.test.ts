import { kit, max, mix, patch } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, type Emission } from '../src/index.js';

describe('channels', () => {
  it('rests at no rate, unscaled values and no offset', () => {
    const m = mix<string, Emission>(kit<Emission>(channels));
    m.sync(0);
    expect(m.probe('a')).toEqual({
      rate: 0,
      speed: 1,
      size: 1,
      life: 1,
      tint: [1, 1, 1, 1],
      offset: [0, 0, 0],
    });
  });

  it('adds rates and offsets, and multiplies scales, across voices on one subject', () => {
    type Pose = Emission & { heat: number };
    const m = mix<string, Pose>(kit<Pose>({ ...channels, heat: max() }));
    const hold = (d: Partial<Pose>) =>
      patch<string, Pose>(0, () => d, { writes: Object.keys(d) as (keyof Pose)[] });
    m.cue({ patch: hold({ rate: 10, speed: 2, offset: [1, 0, 0] }) });
    m.cue({ patch: hold({ rate: 5, speed: 3, offset: [0, 2, 0], heat: 0.5 }) });
    m.sync(0);
    const p = m.probe('a');
    expect([p.rate, p.speed, p.offset, p.heat]).toEqual([15, 6, [1, 2, 0], 0.5]);
  });
});
