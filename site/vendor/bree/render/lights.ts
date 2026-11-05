import type { Board, Led } from '../board.js';
import { frameOf, type Grid, triangleAt } from '../grid.js';
import { type Prims, primBuilder, SOCKET } from './prims.js';

export const SHAPES = { dot: 0, bulb: 1 } as const;
export type ShapeName = keyof typeof SHAPES;

/** How a light's lens is painted: its color, with a pale core over the center. */
export interface Material {
  readonly name: 'led';
  /** The core's radius, as a share of the light's. */
  readonly core: number;
  /** The core's color. */
  readonly coreTint: number;
  /** The core's opacity at full shine. */
  readonly coreAlpha: number;
}

/** A dot's diameter as a share of the pitch, where `lamps.size` leaves it unset. */
export const LAMP_SIZE = 0.72;

export const LED: Material = { name: 'led', core: 0.45, coreTint: 0xfff4e0, coreAlpha: 0.55 };

/** Where each light sits and how big it is, in pitches, in the order the sign was given its lights. */
export interface LightTable {
  readonly n: number;
  /** x, y per light, from the frame's top left. */
  readonly at: Float32Array;
  /** A `SHAPES` value per light. */
  readonly shape: Uint32Array;
  /** Before `lamps.size` is applied. */
  readonly radius: Float32Array;
  readonly frame: { across: number; down: number };
}

/** A light's radius in pitches, before `lamps.size` is applied. */
export function radiusOf(kind: Led['kind']): number {
  return (kind === 'bulb' ? 7 : 6) / 12;
}

/** The table for `leds` on `b`, placed by `grid`. */
export function lightTable(b: Board, leds: readonly Led[], grid: Grid): LightTable {
  const { left, top, across, down } = frameOf(b, grid);
  const at = new Float32Array(leds.length * 2);
  const shape = new Uint32Array(leds.length);
  const radius = new Float32Array(leds.length);
  for (const [i, led] of leds.entries()) {
    const [x, y] = grid(led.x, led.y);
    at[i * 2] = x - left;
    at[i * 2 + 1] = y - top;
    shape[i] = SHAPES[led.kind];
    radius[i] = radiusOf(led.kind);
  }
  return { n: leds.length, at, shape, radius, frame: { across, down } };
}

/**
 * `lightTable`'s lights as primitives, all in view 0: a lamp-scaled disc per light, or on the
 * triangle tiling (`triangles`, given the lights) a lamp-scaled triangle per dot.
 */
export function boardPrims(t: LightTable, triangles?: readonly Led[]): Prims {
  const out = primBuilder();
  for (let i = 0; i < t.n; i++) {
    const x = t.at[i * 2] ?? 0;
    const y = t.at[i * 2 + 1] ?? 0;
    const led = triangles?.[i];
    if (led?.kind === 'dot') {
      const { corners, middle } = triangleAt(led.x, led.y);
      const moved = corners.map(([cx, cy]) => [cx - middle[0] + x, cy - middle[1] + y] as const);
      out.tri(i, 0, SOCKET.dot, moved, { lampScaled: true });
      continue;
    }
    const bulb = t.shape[i] === SHAPES.bulb;
    out.disc(i, 0, bulb ? SOCKET.bulb : SOCKET.dot, x, y, t.radius[i] ?? 0, { lampScaled: true });
  }
  return out.build();
}
