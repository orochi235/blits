import type { Composition } from '../composition';

const c: Composition = {
  version: 1,
  title: 'stagger wave',
  stage: { kind: 'dots', cols: 12, rows: 6 },
  length: 4000,
  levels: [],
  voices: [
    {
      id: 'wave',
      name: 'wave',
      hue: 220,
      start: 0,
      rate: 1,
      loop: true,
      weight: 1,
      fade: { in: 400 },
      stagger: { code: '(s) => s.col * 90 + s.row * 30' },
      patch: {
        kind: 'keys',
        period: 1200,
        stops: [
          { at: 0, delta: { offset: [0, 0], scale: 1 } },
          { at: 0.5, delta: { offset: [0, -18], scale: 1.6 }, ease: 'ease-in-out' },
          { at: 1, delta: { offset: [0, 0], scale: 1 }, ease: 'ease-in-out' },
        ],
      },
    },
  ],
};
export default c;
