import type { Composition } from '../composition';

// `rise` holds after, so its end is unfixed and `drop`, anchored after it, waits until it is faded.
const c: Composition = {
  version: 1,
  title: 'hold handover',
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
      hold: 'after',
      weight: 1,
      fade: {},
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
      start: 0,
      rate: 1,
      loop: 1,
      weight: 1,
      fade: { in: 200 },
      anchor: { start: { after: 'rise' } },
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
