import type { Board, Led } from './board.js';
import type { Defect } from './defects.js';
import { frameOf, GRIDS, type Grid } from './grid.js';
import { axesOf, CHANNELS, type Fade, type Ghost, type SignColumns, shownLit } from './optics.js';
import type { Housing } from './render/housing.js';
import { boardLights, type SignLights } from './render/sign-lights.js';
import { createSign2d, haloRadius } from './render/sign2d.js';

export { createSign2d, frameOf, haloRadius, type SignColumns, shownLit };

/** Fresh columns for `n` lights, every channel at rest. */
export function signColumns(n: number): SignColumns {
  return {
    lit: new Float64Array(n),
    gain: new Float64Array(n).fill(1),
    tint: new Float64Array(n * 4),
    hue: new Float64Array(n),
    chroma: new Float64Array(n).fill(1),
    glow: new Float64Array(n).fill(1),
    invert: new Float64Array(n),
  };
}

/**
 * Copies each border bulb's cell's pose from `cells`, the mix's columns for `b.cells`, into `cols`,
 * where the bulbs follow the dots as `createSign` was given them: every channel, or `channels`.
 */
export function paintBulbs(
  b: Board,
  cells: SignColumns,
  cols: SignColumns,
  channels: Iterable<keyof SignColumns> = CHANNELS,
): void {
  const after = b.dots.length;
  const which = [...channels];
  for (let j = 0; j < b.bulbs.length; j++) {
    const c = b.cellOf[j] as number;
    for (const ch of which) {
      const n = axesOf(ch);
      cols[ch].set(cells[ch].subarray(c * n, c * n + n), (after + j) * n);
    }
  }
}

export interface Sign {
  /** Draws one frame from the mix's columns, `dt` ms after the last. */
  render(cols: SignColumns, fallback: number, dt: number): void;
  /** Replaces the sign's broken lights. */
  setDefects(defects: readonly Defect[]): void;
  /** Sets how fast its lights light and go dark. */
  setFade(fade: Fade): void;
  /** Sets how much an unlit dot shows of its lit row and column. */
  setGhost(ghost: Ghost): void;
  /** Sets how its lights are sized, spaced, lit and bloom. */
  setLamps(lamps: Lamps): void;
  /** Draws other lights from now on, keeping its fade, ghost and lamps; defects are cleared. */
  reshape(next: Shape): void;
  /** Stops following its parent's size. */
  destroy(): void;
}

/** What a sign draws, without its placement: what `reshape` swaps. */
export type Shape = Pick<SignLights, 'board' | 'leds' | 'prims'>;

/** How a sign's lights look, all of them alike. Each is optional; left out, the default holds. */
export interface Lamps {
  /** A dot's diameter, as a share of the pitch; a border bulb is 7/6 of a dot. Default 0.72. */
  size?: number;
  /** CSS pixels from one dot to the next. Default: as large as fits the canvas's parent. */
  pitch?: number;
  /** Multiplies how brightly each light shows. Default 1. */
  brightness?: number;
  /** Multiplies how far each light blooms. Default 1; 0 blooms nothing. */
  glow?: number;
}

/**
 * A sign drawn on `canvas`, each of `leds` at its place on `grid`; the mix's columns arrive in that
 * order, round a `housing` housing (`Housing`).
 */
export function createSign(
  canvas: HTMLCanvasElement,
  b: Board,
  leds: readonly Led[],
  housing: Housing = 'dark',
  grid: Grid = GRIDS.square,
): Sign {
  return createSign2d(canvas, boardLights(b, leds, grid), housing);
}
