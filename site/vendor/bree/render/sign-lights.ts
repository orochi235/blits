import type { Board, Led } from '../board.js';
import { GRIDS, type Grid } from '../grid.js';
import { boardPrims, lightTable } from './lights.js';
import { boardPlacement, type Placement } from './placement.js';
import type { Prims } from './prims.js';

/**
 * What a sign draws: `leds` on `board` as the optics see them, in light order, and the primitives
 * that show them, placed on the canvas by the placement `place` makes. `want` gives the pitch in
 * CSS pixels a sign was asked for, where its placement has one.
 */
export interface SignLights {
  readonly board: Board;
  readonly leds: readonly Led[];
  readonly prims: Prims;
  place(want: () => number | undefined): Placement;
}

/** A board's lights, each a disc at its place on `grid`, fitted to the canvas's parent. */
export function boardLights(b: Board, leds: readonly Led[], grid: Grid): SignLights {
  const t = lightTable(b, leds, grid);
  return {
    board: b,
    leds,
    prims: boardPrims(t, grid === GRIDS.triangles ? leds : undefined),
    place: (want) => boardPlacement(t.frame.across, t.frame.down, want),
  };
}
