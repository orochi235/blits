import type { Pose } from './board.js';

/** A channel of the sign's kit. */
export type Channel = keyof Pose;

/** The four things an effect can vary on a dot, each owning its own channels. */
export type Plane = 'shape' | 'brightness' | 'color' | 'glow';

/** Which channels each plane drives. */
export const PLANES: Readonly<Record<Plane, readonly Channel[]>> = {
  shape: ['lit', 'invert'],
  brightness: ['gain'],
  color: ['tint', 'hue', 'chroma'],
  glow: ['glow'],
};

/** The plane a channel is on. */
export function planeOf(c: Channel): Plane {
  for (const plane of Object.keys(PLANES) as Plane[]) {
    if ((PLANES[plane] as readonly Channel[]).includes(c)) return plane;
  }
  throw new Error(`channel ${c} is on no plane`);
}
