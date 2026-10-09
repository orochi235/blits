import type { Composition, Voice } from '../composition';

const kid = (v: Pick<Voice, 'id' | 'hue' | 'patch'> & Partial<Voice>): Voice => ({
  name: v.id,
  start: 0,
  rate: 1,
  loop: true,
  weight: 1,
  fade: {},
  owner: 'band',
  ...v,
});

// Three voices that the owner `band` fades in and out as one, its weight on the `amount` slider.
const c: Composition = {
  version: 1,
  title: 'owner fade',
  stage: { kind: 'letters', text: 'together' },
  length: 3500,
  levels: [{ name: 'amount', value: 1, min: 0, max: 1 }],
  groups: [
    {
      id: 'band',
      name: 'band',
      hue: 100,
      kind: 'owner',
      start: 300,
      rate: 1,
      weight: { code: "level('amount')" },
      fade: { in: 400, out: 400 },
      anchor: { end: 2800 },
    },
  ],
  voices: [
    kid({
      id: 'bob',
      hue: 210,
      stagger: { code: '(s) => s.index * 60' },
      patch: {
        kind: 'keys',
        period: 800,
        stops: [
          { at: 0, delta: { offset: [0, 0] } },
          { at: 0.5, delta: { offset: [0, -14] }, ease: 'ease-out' },
          { at: 1, delta: { offset: [0, 0] }, ease: 'ease-in' },
        ],
      },
    }),
    kid({
      id: 'warm',
      hue: 25,
      patch: { kind: 'keys', period: 800, stops: [{ at: 0, delta: { color: 0xff9a3c } }] },
    }),
    kid({
      id: 'swell',
      hue: 300,
      patch: {
        kind: 'keys',
        period: 800,
        stops: [
          { at: 0, delta: { scale: 1 } },
          { at: 0.5, delta: { scale: 1.5 }, ease: 'ease-in-out' },
          { at: 1, delta: { scale: 1 }, ease: 'ease-in-out' },
        ],
      },
    }),
  ],
};
export default c;
