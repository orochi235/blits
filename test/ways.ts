import { expect } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { patch } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';

export interface Pose {
  x: number;
  position: number[];
}
export const K = kit<Pose>({ x: sum(), position: vec(2, sum()) });

export interface Part {
  id: number;
}

/** What a scenario hands back: what to do before each frame, and whom and what to read at it. */
export interface Played {
  at?: (t: number) => void;
  /** After the frame's sync, before anything is read. */
  synced?: (t: number) => void;
  read: (t: number) => readonly Part[];
  handles: () => readonly Handle<Part>[];
}

const ways = [
  { lanes: false, pull: false },
  { lanes: true, pull: false },
  { lanes: false, pull: true },
  { lanes: true, pull: true },
];

/**
 * Plays a scenario with lanes off and on, read through `probe` and through `pull`: every pose,
 * every handle's `weightOf` and every `atRest` must be what lanes off and `probe` give.
 */
export function agree(
  play: (m: Mix<Part, Pose>) => Played,
  times: readonly number[],
  check?: (m: Mix<Part, Pose>) => void,
): void {
  const runs = ways.map((way) => {
    const m = mix<Part, Pose>(K, { lanes: way.lanes });
    return { ...way, m, played: play(m) };
  });
  for (const t of times) {
    const seen = runs.map((run) => {
      run.played.at?.(t);
      run.m.sync(t);
      run.played.synced?.(t);
      const parts = run.played.read(t);
      const poses: (number | boolean)[][] = [];
      if (run.pull) {
        const cols = {
          x: new Float64Array(parts.length),
          position: new Float64Array(parts.length * 2),
        };
        run.m.pull(parts, cols);
        parts.forEach((part, i) => {
          poses.push([
            cols.x[i] as number,
            cols.position[i * 2] as number,
            cols.position[i * 2 + 1] as number,
            run.m.atRest(part),
          ]);
        });
      } else
        for (const part of parts) {
          const pose = run.m.probe(part);
          poses.push([pose.x, ...pose.position, run.m.atRest(part)]);
        }
      const weights: number[] = [];
      for (const part of parts)
        for (const h of run.played.handles()) weights.push(h.weightOf(part));
      if (run.lanes) check?.(run.m);
      return { poses, weights };
    });
    const [ref, ...others] = seen as [(typeof seen)[0], ...(typeof seen)[0][]];
    others.forEach((other, w) => {
      const way = `t=${t} lanes ${runs[w + 1]?.lanes ? 'on' : 'off'}${runs[w + 1]?.pull ? ', pull' : ''}`;
      expect(other.poses, `${way} poses`).toEqual(ref.poses);
      expect(other.weights, `${way} weightOf`).toEqual(ref.weights);
    });
  }
}

export const frames = (n: number) => Array.from({ length: n }, (_, f) => f * 16);

export const slide = (p: Part, k: number) =>
  tween<Part, Pose, number[]>('position', {
    from: [p.id, k],
    to: [p.id + 10, k - 5],
    ms: 400 + k * 100,
  });
export const hum = (p: Part) =>
  patch<Part, Pose>(300, (ph) => ({ x: ph * (p.id + 1) }), { writes: ['x'] });
