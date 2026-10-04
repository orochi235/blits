import type { Composition } from '../composition';

const c: Composition = {
  version: 1,
  title: 'pointer glow',
  stage: { kind: 'dots', cols: 10, rows: 5 },
  length: 4000,
  levels: [{ name: 'mouse', value: 0, min: 0, max: 1 }],
  voices: [
    {
      id: 'glow',
      name: 'glow',
      hue: 50,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: { code: 'slew(level("mouse"), { riseMs: 150, fallMs: 900 })' },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [{ at: 0, delta: { glow: 1.5, color: 0xffe08a } }],
      },
    },
  ],
};
export default c;
