import { describe, expect, it } from 'vitest';
import type { VoiceInfo } from '../src/protocol.js';
import { weightSeriesFor } from '../src/ui/Plots.js';

const voice = (id: number, name: string | null): VoiceInfo =>
  ({ id, name }) as unknown as VoiceInfo;

describe('the weightOf plot', () => {
  it('draws a line for each voice, even two voices with one name', () => {
    const weights = new Map([
      [1, [1]],
      [2, [0.5]],
      [3, [0]],
    ]);
    const series = weightSeriesFor(weights, [voice(1, 'fade'), voice(2, 'fade'), voice(3, null)]);
    expect(series.map((s) => s.id)).toEqual(['1', '2', '3']);
    expect(series.map((s) => s.label)).toEqual(['fade', 'fade', '#3']);
  });
});
