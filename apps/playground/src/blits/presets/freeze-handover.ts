import type { Composition } from '../composition';

// `rise` freezes on its last frame until `drop` starts, then fades out under it.
const c: Composition = {
  version: 1,
  title: 'freeze handover',
  stage: { kind: 'letters', text: 'blits' },
  length: 5000,
  levels: [],
  voices: [
    {
      id: 'rise',
      name: 'rise',
      hue: 45,
      start: 0,
      rate: 1,
      loop: 1,
      freeze: 'after',
      weight: 1,
      fade: { out: 400 },
      anchor: { out: { with: 'drop' } },
      stagger: { code: '(s) => s.index * 120' },
      patch: {
        kind: 'keys',
        period: 800,
        stops: [
          { at: 0, delta: { offset: [0, 0] } },
          { at: 1, delta: { offset: [0, -30], color: 0xffd36b }, ease: 'ease-out' },
        ],
      },
    },
    {
      id: 'drop',
      name: 'drop',
      hue: 330,
      start: 2000,
      rate: 1,
      loop: 1,
      weight: 1,
      fade: { in: 200 },
      patch: {
        kind: 'keys',
        period: 1000,
        stops: [
          { at: 0, delta: { turn: 0 } },
          { at: 1, delta: { turn: 360 } },
        ],
      },
    },
  ],
};
export default c;
