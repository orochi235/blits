import type { Composition } from '../composition';

export const DEFAULT: Composition = {
  version: 1,
  title: 'wave',
  stage: { kind: 'dots', cols: 12, rows: 6 },
  length: 6000,
  levels: [{ name: 'lift', value: 1, min: 0, max: 2 }],
  voices: [
    {
      id: 'wave',
      name: 'wave',
      hue: 210,
      start: 0,
      rate: 1,
      loop: true,
      stagger: { code: '(s) => s.col * 80' },
      weight: { code: 'level("lift")' },
      fade: { in: 400 },
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
