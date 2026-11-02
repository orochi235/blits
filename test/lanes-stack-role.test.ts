import { expect, it } from 'vitest';
import { color, kit, mix, overlay, patch } from '../src/index.js';

interface Cell {
  x: number;
}
type Pose = { c: number[] };
const disc = (L: number, a: number, b: number, r: number) =>
  patch<Cell, Pose>(
    1000,
    (phase, s) => {
      const cov = Math.min(1, Math.max(0, 0.5 + (r - Math.abs(s.x - phase)) * 20));
      return { c: [L * cov, a * cov, b * cov, cov] };
    },
    { writes: ['c'] },
  );

/** Subject 29's pose at 450, after every subject was probed at 200. */
function read(lanes: boolean, visit: boolean): number[] {
  const cells = Array.from({ length: 129 }, (_, i) => ({ x: i / 128 }));
  const m = mix<Cell, Pose>(kit<Pose>({ c: color(overlay()) }), { lanes });
  m.sync(0);
  m.cue({ patch: disc(0.63, 0.22, 0.13, 0.2037), subjects: cells, loop: true, role: 'a' });
  m.cue({ patch: disc(0.45, -0.03, -0.19, 0.2551), subjects: cells, loop: true });
  m.cue({ patch: disc(0.8, 0, 0.1, 0.4019), subjects: cells, loop: true, role: 'a', weight: 0.5 });
  if (visit) {
    m.sync(200);
    for (const c of cells) m.probe(c);
  }
  m.sync(450);
  return [...m.probe(cells[29] as Cell).c];
}

it('folds an ordered blend mode role on lanes as the general path does, after an earlier frame', () => {
  const general = read(false, true);
  const laned = read(true, true);
  laned.forEach((v, i) => expect(v).toBeCloseTo(general[i] as number, 9));
});
