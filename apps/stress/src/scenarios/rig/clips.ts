import { keys, kit, type Patch, quat, sum, type Vec, vec } from '@msb235/blits';
import type { Rng } from '@stress/rng';

export interface Pose {
  rot: Vec<4>;
  pos: Vec<3>;
}
export interface Bone {
  char: number;
  bone: number;
  /** Index among every bone of every character. */
  i: number;
}

export const RIG = kit<Pose>({ rot: quat(), pos: vec(3, sum()) });
export const BONES = 20;
/** One arm, which the IK hold takes over. */
export const ARM = [12, 13, 14] as const;
export const isArm = (bone: number) => bone >= 12 && bone <= 14;

export const CLIPS = [
  { name: 'idle', ms: 2400, swing: 0.08 },
  { name: 'walk', ms: 1000, swing: 0.45 },
  { name: 'run', ms: 600, swing: 0.8 },
] as const;
const STOPS = 8;

/** One bone's curve in one clip: `STOPS + 1` keys, the last equal to the first so a loop is seamless. */
export interface Track {
  ats: number[];
  rot: number[][];
  pos: number[][];
}

export function axisAngle(axis: readonly number[], theta: number): number[] {
  const s = Math.sin(theta / 2);
  return [
    (axis[0] as number) * s,
    (axis[1] as number) * s,
    (axis[2] as number) * s,
    Math.cos(theta / 2),
  ];
}

export function unitAxis(r: Rng): number[] {
  const z = 2 * r.next() - 1;
  const a = 2 * Math.PI * r.next();
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z];
}

/** A seeded axis and an angle swinging about a rest angle, sampled at evenly spaced keys. */
export function track(r: Rng, swing: number): Track {
  const axis = unitAxis(r);
  const base = (r.next() - 0.5) * 1.2;
  const amp = swing * (0.5 + r.next());
  const phase = 2 * Math.PI * r.next();
  const lift = (r.next() - 0.5) * 0.2;
  const ats: number[] = [];
  const rot: number[][] = [];
  const pos: number[][] = [];
  for (let k = 0; k <= STOPS; k++) {
    const u = (2 * Math.PI * (k % STOPS)) / STOPS;
    ats.push(k / STOPS);
    rot.push(axisAngle(axis, base + amp * Math.sin(u + phase)));
    pos.push([0.1 * Math.cos(u + phase), lift + amp * 0.1 * Math.sin(2 * u), 0.05 * Math.sin(u)]);
  }
  return { ats, rot, pos };
}

/** A keys patch over the track, writing the channels named. */
export function clip(
  t: Track,
  ms: number,
  writes: readonly (keyof Pose)[],
): Patch<Bone, Pose, void> {
  return keys<Bone, Pose>(
    ms,
    t.ats.map((at, k) => {
      const delta: Partial<Pose> = {};
      if (writes.includes('rot')) delta.rot = t.rot[k] as Vec<4>;
      if (writes.includes('pos')) delta.pos = t.pos[k] as Vec<3>;
      return { at, delta };
    }),
    { kit: RIG },
  );
}
