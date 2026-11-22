import { describe, expect, it, vi } from 'vitest';
import { kit, mul, sum, vec } from '../src/channels.js';
import { type Mixer, mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { patch } from '../src/patch.js';

interface Pose {
  gain: number;
  position: number[];
}
const K = kit<Pose>({ gain: mul(), position: vec(2, sum()) });
type Part = { id: number };

/** A fn keeping state, which no lane runs, on `key` for `ms`. */
const stateful = (ms: number, key: 'gain' | 'position') =>
  patch<Part, Pose, { last: number }>(
    ms,
    (ph, _s, c) => {
      const st = c.state;
      st.last = 0.5 * st.last + ph;
      return key === 'gain' ? { gain: 1 - 0.1 * st.last } : { position: [st.last, -st.last] };
    },
    { writes: [key], state: () => ({ last: 0 }) },
  );

/** One tween a subject on `position`, in a mix with lanes on or off. */
function crowd(lanes: boolean, parts: readonly Part[]) {
  const m = mix<Part, Pose>(K, { lanes });
  for (const p of parts)
    m.cue({
      patch: tween('position', { from: [0, 0], to: [p.id, 1], ms: 1e6 }),
      subjects: [p],
    });
  return m;
}

function read(m: ReturnType<typeof crowd>, list: readonly Part[]) {
  const gain = new Float64Array(list.length);
  const position = new Float64Array(list.length * 2);
  m.pull(list, { gain, position });
  return { gain: [...gain], position: [...position] };
}

describe('pull while a voice plays off lanes', () => {
  for (const key of ['gain', 'position'] as const)
    it(`reads what lanes off reads, the voice on ${key}`, () => {
      const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
      const on = crowd(true, parts);
      const off = crowd(false, parts);
      const both = (f: (m: ReturnType<typeof crowd>) => void) => {
        f(on);
        f(off);
      };
      let list = parts.slice();
      let t = 0;
      const late = { id: 99 };
      for (let f = 0; f < 40; f++) {
        t += 16;
        // Cued over a subject not yet seen, which is numbered while the voice plays.
        if (f === 2)
          both((m) => m.cue({ patch: stateful(200, key), subjects: [parts[3] as Part, late] }));
        if (f === 5) list.push(late);
        if (f === 8)
          both((m) => m.cue({ patch: stateful(50, key), subjects: [parts[30] as Part] }));
        // Swap-remove, which renumbers the last subject into the freed number.
        if (f === 12) {
          const i = list.indexOf(parts[10] as Part);
          list[i] = list[list.length - 1] as Part;
          list.pop();
          both((m) => m.drop(parts[10] as Part));
        }
        if (f === 20)
          both((m) => m.cue({ patch: stateful(100, key), subjects: [list[0] as Part] }));
        if (f === 30) list = list.slice().reverse();
        both((m) => m.sync(t));
        expect(read(on, list), `frame ${f}`).toEqual(read(off, list));
      }
    });

  it('folds only the subjects the voice reaches on the general path', () => {
    const parts = Array.from({ length: 64 }, (_, id) => ({ id }));
    const m = crowd(true, parts);
    let t = 0;
    for (let f = 0; f < 4; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
    }
    m.cue({ patch: stateful(1000, 'gain'), subjects: [parts[7] as Part] });
    t += 16;
    m.sync(t);
    read(m, parts);
    const fold = vi.spyOn(m as unknown as Mixer<Part, Pose>, 'foldWith');
    for (let f = 0; f < 3; f++) {
      t += 16;
      m.sync(t);
      read(m, parts);
    }
    expect(fold.mock.calls.map((c) => (c[0] as Part).id)).toEqual([7, 7, 7]);
  });
});
