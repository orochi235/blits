import { type Board, board, type Led } from '../board.js';
import { ENDS, type Prims, primBuilder, SOCKET } from '../render/prims.js';
import type { DisplayType, Ends, SegLight } from './type.js';
import { half as HALF } from './types/segments.js';

/** What the layout needs of a readout. */
export interface Laid {
  readonly type: DisplayType;
  readonly cells: number;
  readonly face: 'plate' | 'none';
  readonly ends?: Ends;
  /** Whether a ½ digit leads the cells. */
  readonly half?: boolean;
}

/** Where a readout's lights and shapes landed. */
export interface Spot {
  /** Its first row of the board: its slot `s` of cell `c` is the dot at (`c`, `base + s`). */
  readonly base: number;
  /** The board column its first type cell sits in: 1 after a ½ digit, else 0. */
  readonly first: number;
  /** Its extent in local units, faceplate margin included, from (0, 0). */
  readonly width: number;
  readonly height: number;
}

/** Every readout's lights as one board's dots, and the shapes that draw them, a view each. */
export interface Layout {
  readonly board: Board;
  readonly leds: readonly Led[];
  readonly prims: Prims;
  readonly spots: readonly Spot[];
}

/** A faceplate's margin round a readout's cells, as a share of a cell's height. */
const MARGIN = 1 / 15;
const CORNER = 1 / 30;

/**
 * Lays `readouts` out on one board: each a band of rows, one per slot, and a column per cell.
 * Board places no readout fills have no shapes, so nothing draws them.
 */
export function layOutReadouts(readouts: readonly Laid[]): Layout {
  const widthOf = (r: Laid) => r.cells + (r.half ? 1 : 0);
  const slotsOf = (r: Laid) =>
    Math.max(r.type.cell.lights.length, r.half ? HALF.cell.lights.length : 0);
  const cols = Math.max(1, ...readouts.map(widthOf));
  const rows = Math.max(
    1,
    readouts.reduce((n, r) => n + slotsOf(r), 0),
  );
  const b = board(cols, rows, false);
  const out = primBuilder();
  const spots: Spot[] = [];
  let base = 0;
  for (const [v, r] of readouts.entries()) {
    const { cell } = r.type;
    const pad = cell.height * MARGIN;
    const socket =
      r.face === 'none' ? SOCKET.none : r.type.socket === 'wire' ? SOCKET.wire : SOCKET.segment;
    const ends = ENDS[r.ends ?? r.type.ends];
    let x = pad;
    const place = (lights: readonly SegLight[], col: number, glow: number) => {
      for (const [slot, light] of lights.entries()) {
        const i = (base + slot) * cols + col;
        for (const s of light.shapes) {
          if (s.kind === 'disc') out.disc(i, v, socket, x + s.x, pad + s.y, s.r, { glow });
          else if (s.kind === 'tri')
            out.tri(
              i,
              v,
              socket,
              s.points.map(([px, py]) => [x + px, pad + py] as const),
              { glow },
            );
          else if (s.kind === 'bar')
            out.bar(i, v, socket, x + s.x1, pad + s.y1, x + s.x2, pad + s.y2, s.w / 2, ends, glow);
          else
            out.poly(
              i,
              v,
              socket,
              s.points.map(([px, py]) => [x + px, pad + py] as const),
              s.w / 2,
              glow,
            );
        }
      }
    };
    const width = (cells: number) => cells * cell.width + Math.max(0, cells - 1) * r.type.gap;
    const total = (r.half ? HALF.cell.width + r.type.gap : 0) + width(r.cells) + pad * 2;
    const height = cell.height + pad * 2;
    if (r.face === 'plate') out.plate(v, 0, 0, total, height, cell.height * CORNER);
    if (r.half) {
      place(HALF.cell.lights, 0, r.type.glow);
      x += HALF.cell.width + r.type.gap;
    }
    const first = r.half ? 1 : 0;
    for (let c = 0; c < r.cells; c++) {
      place(cell.lights, first + c, r.type.glow);
      x += cell.width + r.type.gap;
    }
    spots.push({ base, first, width: total, height });
    base += slotsOf(r);
  }
  return { board: b, leds: b.dots, prims: out.build(), spots };
}
