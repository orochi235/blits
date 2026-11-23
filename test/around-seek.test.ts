import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { kit, mix, mul, patch } from '../src/index.js';

type Dot = { id: number };
const K = kit<{ gain: number }>({ gain: mul() });
const glow = patch<Dot, { gain: number }>(600, () => ({ gain: 2 }), { writes: ['gain'] });

/** Each frame's gain per dot, under a looping voice weighed by a ball, seeking back and on at frame 6. */
function gains(lanes: boolean, back: number | undefined): number[][] {
  const m = mix<Dot, { gain: number }>(K, { lanes, history: { ms: 100_000, tape } });
  const dots = [{ id: 0 }, { id: 1 }];
  m.plot(dots, new Float64Array([0, 0, 1, 0]), { cell: 2 });
  const out: number[][] = [];
  for (let f = 0; f < 8; f++) {
    if (f === 4) m.cue({ patch: glow, weight: m.around({ x: 0.5, y: 0.4, r: 3.7 }), loop: true });
    if (f === 6 && back !== undefined) {
      const now = m.now;
      m.seek(now - back);
      m.seek(now);
    }
    m.sync(16 * (f + 1));
    out.push(dots.map((d) => m.probe(d).gain));
  }
  return out;
}

for (const back of [10, 20, 40])
  it(`a ball-weighed voice reads the same on the lanes after a seek back ${back} ms and on`, () => {
    const plain = gains(false, undefined);
    expect(gains(false, back)).toEqual(plain);
    expect(gains(true, back)).toEqual(plain);
  });
