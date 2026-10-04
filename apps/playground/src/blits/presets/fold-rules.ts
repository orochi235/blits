import type { Composition, Voice } from '../composition';
import type { Pose } from '../kit';

// Each column folds one channel: two voices on it, the second entering a second later.
const v = (id: string, hue: number, col: number, start: number, delta: Partial<Pose>): Voice => ({
  id,
  name: id,
  hue,
  start,
  rate: 1,
  loop: 1,
  weight: 1,
  fade: { in: 300, out: 300 },
  target: { code: `(s) => s.col === ${col}` },
  patch: { kind: 'keys', period: 2000, stops: [{ at: 0, delta }] },
});

const c: Composition = {
  version: 1,
  title: 'fold rules',
  stage: { kind: 'dots', cols: 3, rows: 1 },
  length: 5000,
  levels: [],
  voices: [
    v('sum a', 10, 0, 0, { turn: 30 }),
    v('sum b', 40, 0, 1000, { turn: 30 }),
    v('mul a', 160, 1, 0, { scale: 1.5 }),
    v('mul b', 190, 1, 1000, { scale: 1.5 }),
    v('max a', 260, 2, 0, { glow: 0.6 }),
    v('max b', 290, 2, 1000, { glow: 0.9 }),
  ],
};
export default c;
