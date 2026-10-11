import type { Composition, Voice } from '../composition';

const sweep = (id: string, row: number, hue: number, over: Partial<Voice>): Voice => ({
  id,
  name: id,
  hue,
  start: 500,
  rate: 1,
  loop: 2,
  weight: 1,
  fade: {},
  freeze: 'both',
  target: { code: `(s) => s.row === ${row}` },
  stagger: { code: '(s) => s.col * 30' },
  patch: {
    kind: 'keys',
    period: 1000,
    stops: [
      { at: 0, delta: { offset: [0, 0], turn: 0, color: 0x3fa9ff } },
      { at: 1, delta: { offset: [0, -18], turn: 180, color: 0xff8f3f }, ease: 'ease-in-out' },
    ],
  },
  ...over,
});

const c: Composition = {
  version: 1,
  title: 'backward',
  stage: { kind: 'dots', cols: 10, rows: 3 },
  length: 4000,
  levels: [],
  voices: [
    sweep('forward', 0, 200, {}),
    sweep('backward', 1, 20, { rate: -1 }),
    sweep('from the middle', 2, 120, { seek: 1000 }),
  ],
};
export default c;
