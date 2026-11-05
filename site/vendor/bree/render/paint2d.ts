import { ENDS, GEOM, PRIM, type Prims, radiusOfPrim } from './prims.js';

/** Whether a traced primitive is filled, or stroked as a line `width` wide. */
export type Traced = { readonly stroke: false } | { readonly stroke: true; readonly width: number };

const FILL: Traced = { stroke: false };

/**
 * Traces primitive `k` on `ctx` in local units as a fresh path, its thickness `r` (a disc's
 * radius, a stroke's half width) in place of its own; a plate keeps its own.
 */
export function tracePrim(ctx: CanvasRenderingContext2D, p: Prims, k: number, r: number): Traced {
  const o = k * GEOM;
  const g = (i: number) => p.geom[o + i] as number;
  ctx.beginPath();
  switch (p.kind[k]) {
    case PRIM.disc:
      ctx.arc(g(0), g(1), Math.max(r, 0), 0, Math.PI * 2);
      return FILL;
    case PRIM.bar: {
      const [x1, y1, x2, y2, , ends] = [g(0), g(1), g(2), g(3), g(4), g(5)];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = len > 0 ? (x2 - x1) / len : 1;
      const uy = len > 0 ? (y2 - y1) / len : 0;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const half = len / 2;
      const at = (along: number, across: number) =>
        [cx + ux * along - uy * across, cy + uy * along + ux * across] as const;
      if (ends === ENDS.round) {
        const a = Math.atan2(uy, ux);
        ctx.arc(...at(half, 0), r, a - Math.PI / 2, a + Math.PI / 2);
        ctx.arc(...at(-half, 0), r, a + Math.PI / 2, a + (Math.PI * 3) / 2);
        ctx.closePath();
        return FILL;
      }
      const corners =
        ends === ENDS.point
          ? [
              at(-half - r, 0),
              at(-half, -r),
              at(half, -r),
              at(half + r, 0),
              at(half, r),
              at(-half, r),
            ]
          : [at(-half, -r), at(half, -r), at(half, r), at(-half, r)];
      ctx.moveTo(...(corners[0] as readonly [number, number]));
      for (const c of corners.slice(1)) ctx.lineTo(...c);
      ctx.closePath();
      return FILL;
    }
    case PRIM.poly: {
      const first = g(0);
      const count = g(1);
      const pt = (i: number) =>
        [p.points[(first + i) * 2] as number, p.points[(first + i) * 2 + 1] as number] as const;
      ctx.moveTo(...pt(0));
      for (let i = 1; i < count; i++) ctx.lineTo(...pt(i));
      if (count === 1) ctx.lineTo(...pt(0));
      return { stroke: true, width: Math.max(r, 0) * 2 };
    }
    case PRIM.tri: {
      const own = radiusOfPrim(p, k, Number.POSITIVE_INFINITY);
      const f = own > 0 ? Math.max(r, 0) / own : 1;
      const mx = (g(0) + g(2) + g(4)) / 3;
      const my = (g(1) + g(3) + g(5)) / 3;
      const at = (i: number) => [mx + (g(i) - mx) * f, my + (g(i + 1) - my) * f] as const;
      ctx.moveTo(...at(0));
      ctx.lineTo(...at(2));
      ctx.lineTo(...at(4));
      ctx.closePath();
      return FILL;
    }
    default:
      ctx.roundRect(g(0), g(1), g(2) - g(0), g(3) - g(1), g(4));
      return FILL;
  }
}

/** Fills or strokes what `tracePrim` traced, in `style`. */
export function paintTraced(ctx: CanvasRenderingContext2D, t: Traced, style: string): void {
  if (t.stroke) {
    ctx.strokeStyle = style;
    ctx.lineWidth = t.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else {
    ctx.fillStyle = style;
    ctx.fill();
  }
}

/** Primitive `k` traced at its own thickness. */
export const traceOwn = (ctx: CanvasRenderingContext2D, p: Prims, k: number, lamp: number) =>
  tracePrim(ctx, p, k, radiusOfPrim(p, k, lamp));
