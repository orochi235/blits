import type { Voice } from '@pg/blits/composition';
import { groupParams, levelParams, paramLine, voiceParams } from '@pg/blits/params';
import { describe, expect, it } from 'vitest';
import { group } from './helpers';

const voice = (over: Partial<Voice>): Voice => ({
  id: 'v',
  name: 'v',
  hue: 0,
  start: 0,
  rate: 1,
  loop: false,
  fade: {},
  weight: 1,
  patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { glow: 1 } }] },
  ...over,
});

describe('voiceParams', () => {
  it('leaves out every default, keeping the patch', () => {
    expect(voiceParams(voice({}), false)).toEqual([
      ['period', '1000 ms'],
      ['stops', '1'],
    ]);
  });

  it('shows what a voice sets away from its default, the patch first', () => {
    const v = voice({
      loop: true,
      start: 200,
      rate: 0.5,
      weight: 0.25,
      fade: { in: 400 },
      freeze: 'after',
      role: 'r',
      tags: ['a', 'b'],
      marks: { peak: 300 },
      patch: {
        kind: 'wave',
        period: 800,
        shape: 'sine',
        cycles: 2,
        phase: 0,
        depth: { scale: 0.2 },
      },
    });
    expect(voiceParams(v, true)).toEqual([
      ['period', '800 ms'],
      ['shape', 'sine'],
      ['cycles', '2'],
      ['depth · scale', '0.2'],
      ['passes', '∞'],
      ['start', '200 ms'],
      ['rate', '0.5×'],
      ['weight', '0.25'],
      ['fade in', '400 ms'],
      ['freeze', 'after'],
      ['role', 'r (blend)'],
      ['mark · peak', '300 ms'],
      ['tags', 'a, b'],
    ]);
  });

  it('shows an anchored start as anchored, not as its unused number', () => {
    const v = voice({ start: 500, anchor: { start: { after: 'x' } as never } });
    expect(voiceParams(v, false)).toContainEqual(['start', 'anchored']);
    expect(voiceParams(v, false)).not.toContainEqual(['start', '500 ms']);
  });
});

describe('groupParams', () => {
  it("puts a span's own settings first", () => {
    const g = group({ id: 'g', kind: 'span', rate: 2, span: { duration: 2000, order: 'queue' } });
    expect(groupParams(g)).toEqual([
      ['duration', '2000 ms'],
      ['order', 'queue'],
      ['rate', '2×'],
    ]);
  });
});

describe('levelParams and paramLine', () => {
  it('gives a level its value and range, and a line of params', () => {
    const params = levelParams({ name: 'x', value: 0.5, min: 0, max: 1 });
    expect(params).toEqual([
      ['value', '0.5'],
      ['range', '0–1'],
    ]);
    expect(paramLine(params)).toBe('value 0.5 · range 0–1');
  });
});
