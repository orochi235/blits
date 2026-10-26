import type { Composition } from '../composition';

const c: Composition = {
  version: 1,
  title: 'bounded glow',
  stage: { kind: 'dots', cols: 48, rows: 20 },
  length: 4000,
  levels: [],
  voices: [
    {
      id: 'shimmer',
      name: 'shimmer',
      hue: 210,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: 1,
      stagger: { code: '(s) => (s.col * 37 + s.row * 91) % 1500' },
      patch: {
        kind: 'keys',
        period: 1500,
        stops: [
          { at: 0, delta: { opacity: 0.55 } },
          { at: 0.5, delta: { opacity: 0.8 } },
          { at: 1, delta: { opacity: 0.55 } },
        ],
      },
    },
    {
      id: 'glow',
      name: 'glow',
      hue: 50,
      start: 0,
      rate: 1,
      loop: true,
      fade: {},
      weight: { code: 'around(6, { ease: "ease-out" })' },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [{ at: 0, delta: { glow: 2, scale: 1.6, color: 0xffe08a } }],
      },
    },
  ],
};
export default c;
