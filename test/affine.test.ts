import { describe, expect, it } from 'vitest';
import { affine, matrix, partsOf } from '../src/affine.js';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  at: number[];
}
interface Part {
  id: number;
}

const closeAll = (a: readonly number[] | undefined, b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  (a as number[]).forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] as number, 9);
  });
};

const holds = (m: number[]) => patch<Part, Pose>(0, () => ({ at: m }), { writes: ['at'] });

/** Where `m` takes the point `[x, y]`. */
const apply = (m: readonly number[], x: number, y: number) => [
  (m[0] as number) * x + (m[2] as number) * y + (m[4] as number),
  (m[1] as number) * x + (m[3] as number) * y + (m[5] as number),
];

/** The pose `voices`, each a matrix and a weight, fold to, cued in order. */
function folded(voices: [number[], number][], opts?: { lanes?: boolean }): number[] {
  const m = mix<Part, Pose>(kit<Pose>({ at: affine() }), opts);
  for (const [value, weight] of voices) m.cue({ patch: holds(value), weight });
  m.sync(0);
  return m.probe({ id: 0 }).at as number[];
}

const QUARTER = Math.PI / 2;

describe('matrix', () => {
  it('scales, shears, rotates, then moves', () => {
    const m = matrix({ x: 10, y: 5, rotate: QUARTER, scale: 2 });
    closeAll(apply(m, 1, 0), [10, 7]);
    closeAll(matrix({}), [1, 0, 0, 1, 0, 0]);
    closeAll(apply(matrix({ skew: Math.PI / 4 }), 0, 1), [1, 1]);
    closeAll(apply(matrix({ scaleX: 3, scale: 2 }), 1, 1), [6, 2]);
  });
});

describe('affine', () => {
  it('rests at the identity and gives one voice its own matrix', () => {
    closeAll(folded([]), [1, 0, 0, 1, 0, 0]);
    const m = matrix({ x: 3, rotate: 0.4, scaleY: 2, skew: 0.2 });
    closeAll(folded([[m, 1]]), m);
  });

  it('composes in cue order, the first cued outermost', () => {
    const turn = matrix({ rotate: QUARTER });
    const move = matrix({ x: 10 });
    closeAll(
      apply(
        folded([
          [turn, 1],
          [move, 1],
        ]),
        0,
        0,
      ),
      [0, 10],
    );
    closeAll(
      apply(
        folded([
          [move, 1],
          [turn, 1],
        ]),
        0,
        0,
      ),
      [10, 0],
    );
  });

  it('takes a weighted voice part of the way from no transform, by its parts', () => {
    closeAll(
      folded([[matrix({ x: 8, rotate: QUARTER, scale: 3 }), 0.5]]),
      matrix({ x: 4, rotate: QUARTER / 2, scale: 2 }),
    );
    closeAll(folded([[matrix({ scaleY: -1 }), 0.5]]), matrix({ scaleY: 0 }));
  });

  it('crossfades a role by its parts, the rotation the short way round', () => {
    const m = mix<Part, Pose>(kit<Pose>({ at: affine() }));
    m.cue({ patch: holds(matrix({ rotate: 3 })), weight: 0.5, role: 'r' });
    m.cue({ patch: holds(matrix({ rotate: -3 })), weight: 0.5, role: 'r' });
    m.sync(0);
    closeAll(m.probe({ id: 0 }).at as number[], matrix({ rotate: Math.PI }));
  });

  it('folds the same on lanes as on the general path, beside a laned channel', () => {
    interface Both {
      at: number[];
      gain: number;
    }
    const run = (lanes: boolean) => {
      const m = mix<Part, Both>(kit<Both>({ at: affine(), gain: sum() }), { lanes });
      const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
      m.cue({
        patch: patch<Part, Both>(1000, (t, p) => ({ at: matrix({ rotate: t + p.id }), gain: 1 }), {
          writes: ['at', 'gain'],
        }),
        loop: true,
      });
      m.cue({
        patch: patch<Part, Both>(0, (_, p) => ({ at: matrix({ x: p.id, scale: 1.5 }) }), {
          writes: ['at'],
        }),
        weight: 0.6,
      });
      const out: number[] = [];
      for (const t of [0, 250, 600]) {
        m.sync(t);
        for (const p of parts) out.push(...(m.probe(p).at as number[]));
      }
      const laned = (m as unknown as { lanes: { laned: { name: string }[] } | null }).lanes;
      expect(laned?.laned.some((c) => c.name === 'at') ?? false).toBe(lanes);
      return out;
    };
    const off = run(false);
    const on = run(true);
    expect(on).toHaveLength(off.length);
    on.forEach((v, i) => {
      expect(Object.is(v, off[i]), `[${i}]`).toBe(true);
    });
  });
});

describe('partsOf', () => {
  it('gives back the parts matrix was given, so matrix(partsOf(m)) is m', () => {
    const given = { x: 40, y: -3, rotate: 0.7, skew: 0.2, scaleX: 2, scaleY: 0.5 };
    const p = partsOf(matrix(given));
    for (const k of Object.keys(given) as (keyof typeof given)[])
      expect(p[k]).toBeCloseTo(given[k], 12);
    closeAll(matrix(p), matrix(given));
  });
});
