import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { ink, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { spring, tween } from '../src/motion.js';
import { patch } from '../src/patch.js';
import { input } from '../src/signals.js';
import type { Mix } from '../src/types.js';

interface Pose {
  value: number;
  heat: number[];
}
interface Cell {
  i: number;
}

const N = 12;
const BANDS = [oklab(0x3a7bd5), oklab(0xf2c14e), oklab(0xe0303a)];

/**
 * The stress heatmap's shape: a motion voice on `value`, retargeted on some cells every frame, and
 * three voices on `heat` weighted per cell. `after` cues one more voice on `value` after them.
 */
function heatmap(lanes: boolean, move: 'spring' | 'tween', after = false) {
  const m: Mix<Cell, Pose> = mix<Cell, Pose>(kit<Pose>({ value: sum(), heat: ink() }), { lanes });
  m.sync(0);
  const cells = Array.from({ length: N }, (_, i) => ({ i }));
  const heat = new Float64Array(N).map((_, i) => (i % 5) / 4);
  const goal = (c: Cell) => c.i;
  const motion =
    move === 'spring'
      ? spring<Cell, Pose>('value', { from: 0, to: goal })
      : tween<Cell, Pose>('value', { from: 0, to: goal, ms: 200 });
  m.cue({ patch: motion, subjects: cells });
  let weighed = 0;
  const weights = BANDS.map((band, b) => {
    const w = input<Cell>((c) => {
      weighed++;
      return Math.max(0, 1 - Math.abs(2 * (heat[c.i] as number) - b));
    });
    m.cue({
      patch: patch<Cell, Pose>(0, () => ({ heat: band }), { writes: ['heat'] }),
      subjects: cells,
      weight: w,
    });
    return w;
  });
  if (after)
    m.cue({
      patch: patch<Cell, Pose>(0, (_p, c) => ({ value: c.i / 7 }), { writes: ['value'] }),
      subjects: cells,
    });
  const value = new Float64Array(N);
  const hue = new Float64Array(N * 5);
  return {
    /** Retargets every third cell from `f`, moves the heat, syncs to frame `f` and pulls. */
    frame(f: number): Float64Array {
      for (let i = f % 3; i < N; i += 3) motion.to(cells[i] as Cell, f + i);
      for (let i = 0; i < N; i++) heat[i] = ((heat[i] as number) * 0.9 + (f % 7) / 10) % 1;
      for (const w of weights) w.touch();
      m.sync(f * 16);
      m.pull(cells, { value, heat: hue });
      return Float64Array.from([...value, ...hue]);
    },
    weighed: () => weighed,
    probe: (i: number) => m.probe(cells[i] as Cell),
  };
}

describe('a motion voice with a retarget waiting, on lanes', () => {
  for (const move of ['spring', 'tween'] as const)
    for (const after of [false, true])
      it(`reads the same bits as the general path (${move}${after ? ', a voice after it on its channel' : ''})`, () => {
        const off = heatmap(false, move, after);
        const on = heatmap(true, move, after);
        for (let f = 1; f <= 40; f++) {
          const a = off.frame(f);
          const b = on.frame(f);
          for (let k = 0; k < a.length; k++)
            if (!Object.is(a[k], b[k])) expect([f, k, b[k]]).toEqual([f, k, a[k]]);
          if (f % 9 === 0) for (let i = 0; i < N; i++) expect(on.probe(i)).toEqual(off.probe(i));
        }
      });

  it("leaves the subject's other voices on the lanes", () => {
    // Each weight is read once a cell a frame on the lanes; a retargeted cell sent down the general
    // path for every voice read its weights there a second time.
    const on = heatmap(true, 'spring');
    for (let f = 1; f <= 5; f++) on.frame(f);
    const before = on.weighed();
    on.frame(6);
    expect(on.weighed() - before).toBe(N * BANDS.length);
  });
});
