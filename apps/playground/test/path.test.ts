import { insetRange, pathOf, rangeOf } from '@pg/widgets/ChannelPlot/path';
import { describe, expect, it } from 'vitest';

describe('ChannelPlot paths', () => {
  it('pads the range and never collapses it', () => {
    expect(rangeOf([{ id: 'a', hue: 0, values: [0, 10] }])).toEqual([-0.5, 10.5]);
    expect(rangeOf([{ id: 'a', hue: 0, values: [3, 3] }])).toEqual([2.5, 3.5]);
    expect(rangeOf([])).toEqual([-0.5, 0.5]);
  });
  it('leaves px pixels of room beyond each end of the range', () => {
    const [lo, hi] = insetRange([0, 1], 10, 100);
    expect(lo).toBeCloseTo(-0.125);
    expect(hi).toBeCloseTo(1.125);
    expect(((0 - lo) / (hi - lo)) * 100).toBeCloseTo(10);
  });
  it('builds a polyline path, skipping non-finite values', () => {
    expect(
      pathOf(
        [0, 1, 2],
        [0, Number.NaN, 2],
        (t) => t * 10,
        (v) => v,
      ),
    ).toBe('M0 0M20 2');
    expect(
      pathOf(
        [0, 1],
        [1, 2],
        (t) => t,
        (v) => -v,
      ),
    ).toBe('M0 -1L1 -2');
  });
});
