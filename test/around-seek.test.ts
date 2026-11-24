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

for (const lanes of [true, false])
  for (const by of ['around', 'within'] as const)
    it(`a seek back or read back before a drop gives the subject its plot index (${by}, lanes ${lanes ? 'on' : 'off'})`, () => {
      const m = mix<Dot, { gain: number }>(K, { lanes, history: { ms: 100_000, every: 50, tape } });
      const dots = [{ id: 0 }, { id: 1 }];
      m.plot(dots, new Float64Array([0, 0, 1, 0]));
      const ramp = patch<Dot, { gain: number }>(1000, (ph) => ({ gain: 1 + ph }), {
        writes: ['gain'],
      });
      const finder = {
        find(out: Int32Array) {
          out[0] = 0;
          return 1;
        },
      };
      const live = new Map<number, number>();
      for (const t of [0, 16, 32, 48]) {
        m.sync(t);
        if (t === 0)
          m.cue({
            patch: ramp,
            loop: true,
            ...(by === 'around'
              ? { weight: m.around({ x: 0, y: 0, r: 2 }) }
              : { weight: () => 1, within: finder }),
          });
        if (t === 48) m.drop(dots[0] as Dot);
        live.set(t, m.probe(dots[0] as Dot).gain);
      }
      expect(m.project(16).probe(dots[0] as Dot).gain).toBe(live.get(16));
      m.seek(16);
      expect(m.probe(dots[0] as Dot).gain).toBe(live.get(16));
      expect(m.project(32).probe(dots[0] as Dot).gain).toBe(live.get(32));
      m.seek(48);
      expect(m.probe(dots[0] as Dot).gain).toBe(live.get(48));
    });

it('a dropped subject’s index is handed out again once history no longer reaches the drop', () => {
  const m = mix<Dot, { gain: number }>(K, { history: { ms: 100, tape } });
  const a = { id: 0 };
  m.sync(0);
  expect(m.place(a)).toBe(0);
  m.drop(a);
  m.sync(50);
  expect(m.place({ id: 1 })).toBe(1);
  m.sync(200);
  expect(m.place({ id: 2 })).toBe(0);
});
