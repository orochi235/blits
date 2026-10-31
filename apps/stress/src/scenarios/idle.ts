import { keys, kit, mix, sum } from '@msb235/blits';
import type { Make } from '@stress/scenario';

interface Pose {
  x: number;
}
interface Dot {
  id: number;
}

const DOT = kit<Pose>({ x: sum() });
const FRAME_MS = 1000 / 60;

export const idle: Make = ({ lanes }) => {
  const m = mix<Dot, Pose>(DOT, { name: 'idle', lanes });
  const dot: Dot = { id: 0 };
  m.sync(0);
  m.cue({
    patch: keys<Dot, Pose>(
      1000,
      [
        { at: 0, delta: { x: 0 } },
        { at: 1, delta: { x: 1 } },
      ],
      {},
    ),
    subjects: [dot],
    loop: true,
  });
  const pose = { x: 0 };
  return {
    name: 'idle',
    frameMs: FRAME_MS,
    width: 1,
    step: (f) => m.sync(f * FRAME_MS),
    read: (out) => {
      m.probe(dot, pose);
      out[0] = pose.x;
    },
    stats: () => ({ voices: m.voices().length }),
    check: () => [],
    close: () => m.close(),
  };
};
