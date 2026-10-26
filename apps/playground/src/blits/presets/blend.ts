import type { Composition, Voice } from '../composition';

const stop = (id: string, hue: number, color: number, scale: number, turn: number): Voice => ({
  id,
  name: id,
  hue,
  start: 0,
  rate: 1,
  loop: true,
  role: 'tone',
  fade: { in: 300 },
  weight: 1,
  patch: {
    kind: 'keys',
    period: 1200,
    stops: [
      { at: 0, delta: { color, scale: 1, turn: 0 } },
      { at: 0.5, delta: { color, scale, turn }, ease: 'ease-in-out' },
      { at: 1, delta: { color, scale: 1, turn: 0 }, ease: 'ease-in-out' },
    ],
  },
});

const c: Composition = {
  version: 1,
  title: 'blend',
  stage: { kind: 'dots', cols: 12, rows: 4 },
  length: 6000,
  levels: [{ name: 'slide', value: 0, min: -1, max: 1 }],
  blends: { tone: { code: '(s, set) => Math.min(1, Math.max(0, s.x + level("slide")(s, set)))' } },
  voices: [
    stop('warm', 25, 0xff8f3f, 1.5, 0),
    stop('green', 130, 0x5fd38a, 0.6, 90),
    stop('cool', 215, 0x3fa9ff, 1.3, 0),
  ],
};
export default c;
