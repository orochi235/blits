import type { Composition } from '../composition';

const c: Composition = {
  version: 1,
  title: 'spring retarget',
  stage: { kind: 'dots', cols: 6, rows: 3 },
  length: 5000,
  levels: [],
  voices: [
    {
      id: 'spring',
      name: 'spring',
      hue: 280,
      start: 0,
      rate: 1,
      loop: true,
      weight: 1,
      fade: {},
      patch: {
        kind: 'spring',
        channel: 'offset',
        opts: { from: [0, -60], to: { code: '(s) => [0, 0]' }, stiffness: 120, damping: 8 },
      },
    },
  ],
};
export default c;
