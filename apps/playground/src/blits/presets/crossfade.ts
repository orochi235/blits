import type { Composition } from '../composition';

const c: Composition = {
  version: 1,
  title: 'crossfade',
  stage: { kind: 'dots', cols: 8, rows: 4 },
  length: 6000,
  levels: [{ name: 'mix', value: 0.5, min: 0, max: 1 }],
  voices: [
    {
      id: 'warm',
      name: 'warm',
      hue: 25,
      start: 0,
      rate: 1,
      loop: true,
      locus: 'tone',
      fade: {},
      weight: { code: '(s, set) => 1 - level("mix")(s, set)' },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [{ at: 0, delta: { color: 0xff8f3f, scale: 1.4 } }],
      },
    },
    {
      id: 'cool',
      name: 'cool',
      hue: 200,
      start: 0,
      rate: 1,
      loop: true,
      locus: 'tone',
      fade: {},
      weight: { code: 'level("mix")' },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [{ at: 0, delta: { color: 0x3fa9ff, scale: 0.7 } }],
      },
    },
  ],
};
export default c;
