import { describe, expect, it } from 'vitest';
import type { MarkInfo, VoiceInfo } from '../src/protocol.js';
import { AHEAD_CAP_MS, AHEAD_MS } from '../src/store.js';
import { axisOf, lanesOf } from '../src/ui/lanes.js';

const mark = (at: number, voice: number | null, m: string | null, name = 'v'): MarkInfo => ({
  at,
  mark: m,
  voice,
  name,
  tags: [],
});
const voice = (id: number, state: string, name: string | null = null): VoiceInfo => ({
  id,
  name,
  tags: [],
  state,
  weight: Number.NaN,
  bounded: false,
});

describe('the plan', () => {
  it('lays out a lane per voice from its start to its end, open where no end is known', () => {
    const { lanes, announced } = lanesOf(
      [
        mark(100, 2, 'start', 'a'),
        mark(300, 2, 'end', 'a'),
        mark(200, 3, 'start', 'b'),
        mark(250, null, null, 'beat'),
      ],
      [voice(2, 'live', 'a'), voice(3, 'pending', 'b'), voice(4, 'live', 'c')],
    );
    expect(lanes.map((l) => [l.label, l.from, l.to])).toEqual([
      ['c', Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      ['a', 100, 300],
      ['b', 200, Number.POSITIVE_INFINITY],
    ]);
    expect(announced.map((m) => m.name)).toEqual(['beat']);
  });

  it('runs the axis a little past now, out to the furthest mark within the cap', () => {
    expect(axisOf(1000, [0, 500, 1000], [])).toEqual([0, 1000 + AHEAD_MS]);
    expect(axisOf(1000, [0, 1000], [mark(9000, 1, 'end')])).toEqual([0, 9000]);
    expect(axisOf(1000, [0, 1000], [mark(1e9, null, null)])).toEqual([0, 1000 + AHEAD_CAP_MS]);
    expect(axisOf(1000, [], [mark(-5000, 1, 'start')])).toEqual([-5000, 1000 + AHEAD_MS]);
    expect(axisOf(1000, [], [])).toEqual([1000 - AHEAD_MS, 1000 + AHEAD_MS]);
  });
});
