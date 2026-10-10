import { describe, expect, it } from 'vitest';
import { kit, last, max, mul, sum, type Vec, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { quat } from '../src/rotation.js';
import { fold } from '../src/stack.js';

interface Pose {
  position: Vec<3>;
  scale: number;
  dark: number;
  opacity: number;
  spin: Vec<4>;
  label?: string;
  tint?: number[];
}

const POSE = kit<Pose>({
  position: vec(3, sum()),
  scale: mul(),
  dark: max(),
  opacity: mul({ bounds: [0, 1] }),
  spin: quat(),
  label: last<string>(),
  tint: last<number[]>(),
});

const half = Math.SQRT1_2;
const deltas: Partial<Pose>[] = [
  { position: [1, 2, 3], scale: 2, label: 'a', tint: [1, 0, 0] },
  { position: [-4, 0, 1], dark: 0.5, opacity: 3, spin: [0, 0, half, half] },
  { scale: 0.5, dark: 0.8, label: 'b', spin: [half, 0, 0, half] },
  { opacity: 0.25, tint: [0, 1, 0] },
];

/** What a mix gives for one voice per delta, at these weights. */
function mixed(weights?: readonly number[]): Pose {
  const m = mix<string, Pose>(POSE);
  deltas.forEach((delta, i) => {
    m.cue({
      patch: patch<string, Pose>(0, () => delta, { writes: Object.keys(delta) as (keyof Pose)[] }),
      weight: weights?.[i] ?? 1,
    });
  });
  m.sync(0);
  return m.probe('a');
}

describe('fold', () => {
  it('is the mix with every weight at 1 where none is given', () => {
    expect(fold(POSE, deltas)).toEqual(mixed());
  });

  for (const weights of [
    [1, 0.5, 0.25, 1],
    [0.3, 1, 0.7, 0],
    [0.6, 0.59, 0, 0.61],
    [0, 0, 0, 0],
  ])
    it(`is the mix at weights ${weights.join(', ')}`, () => {
      expect(fold(POSE, deltas, weights)).toEqual(mixed(weights));
    });

  it('with no deltas is every channel at rest, and a rest-less one undefined', () => {
    const pose = fold(POSE, []);
    expect(pose).toEqual({
      position: [0, 0, 0],
      scale: 1,
      dark: 0,
      opacity: 1,
      spin: [0, 0, 0, 1],
      label: undefined,
      tint: undefined,
    });
  });

  it('holds a weight to 0..1 and a pose to its bounds', () => {
    expect(fold(POSE, [{ scale: 3 }], [5]).scale).toBe(3);
    expect(fold(POSE, [{ scale: 3 }], [-1]).scale).toBe(1);
    expect(fold(POSE, [{ opacity: 4 }]).opacity).toBe(1);
  });

  it('hands back nothing a delta or the kit still holds', () => {
    const position: Vec<3> = [1, 1, 1];
    const tint = [0.5, 0.5, 0.5];
    const pose = fold(POSE, [{ position, tint }]);
    expect(pose.position).not.toBe(position);
    expect(pose.position).not.toBe(POSE.position.rest);
    expect(pose.tint).not.toBe(tint);
    expect(fold(POSE, []).spin).not.toBe(POSE.spin.rest);
  });
});
