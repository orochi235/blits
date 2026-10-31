import type { Track } from './clips';

export type Q = number[];
const IDENTITY: Q = [0, 0, 0, 1];

export const dot = (a: Q, b: Q) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number) +
  (a[3] as number) * (b[3] as number);

function normalize(v: Q): Q {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/** The short arc from `a` to `b` at `u`. */
export function slerp(a: Q, b: Q, u: number): Q {
  let d = dot(a, b);
  const sign = d < 0 ? -1 : 1;
  d *= sign;
  let p = 1 - u;
  let q = u;
  if (d < 1 - 1e-9) {
    const theta = Math.acos(d);
    const s = Math.sin(theta);
    p = Math.sin((1 - u) * theta) / s;
    q = Math.sin(u * theta) / s;
  }
  q *= sign;
  return normalize(a.map((x, k) => p * x + q * (b[k] as number)));
}

/** A track's rotation at `phase`, each key to the next along the short arc. */
export function sample(t: Track, phase: number): Q {
  let k = 0;
  while (k < t.ats.length - 2 && phase >= (t.ats[k + 1] as number)) k++;
  const a = t.ats[k] as number;
  const b = t.ats[k + 1] as number;
  return slerp(t.rot[k] as Q, t.rot[k + 1] as Q, (phase - a) / (b - a));
}

export interface Member {
  q: Q;
  w: number;
}

/**
 * A role's rotation as role.mdx documents it: members in cue order, each lerped (for a quat, the
 * short arc) into the running value by its share of the weight so far; the result then counts at
 * weight `min(1, Σw)`, turned that far from no rotation.
 */
export function roleBlend(members: readonly Member[]): Q {
  let acc: Q | undefined;
  let total = 0;
  for (const { q, w } of members) {
    if (!(w > 0)) continue;
    total += w;
    acc = acc === undefined ? q : slerp(acc, q, w / total);
  }
  if (acc === undefined) return IDENTITY;
  return total >= 1 ? slerp(IDENTITY, acc, 1) : slerp(IDENTITY, acc, total);
}

/** The normalized weighted sum of the members, each sign-aligned to the first. */
export function meanBlend(members: readonly Member[]): Q {
  const live = members.filter((x) => x.w > 0);
  const first = live[0]?.q;
  if (first === undefined) return IDENTITY;
  const sum = [0, 0, 0, 0];
  for (const { q, w } of live) {
    const s = dot(first, q) < 0 ? -w : w;
    for (let k = 0; k < 4; k++) sum[k] = (sum[k] as number) + s * (q[k] as number);
  }
  return normalize(sum);
}

/** How far apart two rotations are: 0 the same, up to 1. `q` and `-q` are one rotation. */
export const apart = (a: Q, b: Q) => 1 - Math.abs(dot(a, b));
