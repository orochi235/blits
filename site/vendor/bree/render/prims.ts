/** What a primitive is: drawn by every backend from its distance. */
export const PRIM = { disc: 0, bar: 1, poly: 2, plate: 3, tri: 4 } as const;
/** How much of its place a lamp-scaled triangle fills per unit of `lamps.size`, at most all. */
export const TRI_FILL = 1.25;
/** How a bar ends: tapered to a point at 45°, a half disc, or cut square. */
export const ENDS = { point: 0, round: 1, square: 2 } as const;
/** What an unlit primitive shows of itself in the housing. */
export const SOCKET = { none: 0, dot: 1, bulb: 2, segment: 3, wire: 4, plate: 5 } as const;
/** Floats per primitive in `geom`. */
export const GEOM = 8;
/** A primitive no light owns, such as a faceplate: it is housing only. */
export const NO_LIGHT = 0xffffffff;

/**
 * Shapes in local units, each owned by a light and placed through a view. `geom` per kind:
 * disc `[cx, cy, r, lampScaled, glow]`, bar `[x1, y1, x2, y2, halfWidth, ends, glow]`, poly
 * `[first, count, halfWidth, glow, minX, minY, maxX, maxY]` over `points`' pairs, plate
 * `[x0, y0, x1, y1, corner]`, triangle `[x1, y1, x2, y2, x3, y3, lampScaled, glow]`. A lamp-scaled
 * triangle shrinks toward its middle to `lamps.size * TRI_FILL` of itself. A lamp-scaled disc's radius is multiplied by `lamps.size`.
 */
export interface Prims {
  readonly n: number;
  readonly light: Uint32Array;
  readonly view: Uint32Array;
  readonly kind: Uint32Array;
  readonly socket: Uint32Array;
  readonly geom: Float32Array;
  readonly points: Float32Array;
}

type Socket = (typeof SOCKET)[keyof typeof SOCKET];
type Ends = (typeof ENDS)[keyof typeof ENDS];

/** Collects primitives in order, then packs them into a `Prims`. */
export interface PrimBuilder {
  disc(
    light: number,
    view: number,
    socket: Socket,
    cx: number,
    cy: number,
    r: number,
    o?: { lampScaled?: boolean; glow?: number },
  ): void;
  bar(
    light: number,
    view: number,
    socket: Socket,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    halfWidth: number,
    ends: Ends,
    glow?: number,
  ): void;
  poly(
    light: number,
    view: number,
    socket: Socket,
    points: readonly (readonly [number, number])[],
    halfWidth: number,
    glow?: number,
  ): void;
  plate(view: number, x0: number, y0: number, x1: number, y1: number, corner: number): void;
  tri(
    light: number,
    view: number,
    socket: Socket,
    corners: readonly (readonly [number, number])[],
    o?: { lampScaled?: boolean; glow?: number },
  ): void;
  build(): Prims;
}

export function primBuilder(): PrimBuilder {
  const light: number[] = [];
  const view: number[] = [];
  const kind: number[] = [];
  const socket: number[] = [];
  const geom: number[] = [];
  const points: number[] = [];
  const add = (l: number, v: number, k: number, s: number, g: readonly number[]) => {
    light.push(l);
    view.push(v);
    kind.push(k);
    socket.push(s);
    for (let i = 0; i < GEOM; i++) geom.push(g[i] ?? 0);
  };
  return {
    disc(l, v, s, cx, cy, r, o = {}) {
      add(l, v, PRIM.disc, s, [cx, cy, r, o.lampScaled ? 1 : 0, o.glow ?? 1]);
    },
    bar(l, v, s, x1, y1, x2, y2, hw, ends, glow = 1) {
      add(l, v, PRIM.bar, s, [x1, y1, x2, y2, hw, ends, glow]);
    },
    poly(l, v, s, pts, hw, glow = 1) {
      const first = points.length / 2;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of pts) {
        points.push(x, y);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      add(l, v, PRIM.poly, s, [first, pts.length, hw, glow, x0, y0, x1, y1]);
    },
    tri(l, v, s, corners, o = {}) {
      const [a, b, c] = corners as [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ];
      add(l, v, PRIM.tri, s, [...a, ...b, ...c, o.lampScaled ? 1 : 0, o.glow ?? 1]);
    },
    plate(v, x0, y0, x1, y1, corner) {
      add(NO_LIGHT, v, PRIM.plate, SOCKET.plate, [x0, y0, x1, y1, corner]);
    },
    build: () => ({
      n: kind.length,
      light: Uint32Array.from(light),
      view: Uint32Array.from(view),
      kind: Uint32Array.from(kind),
      socket: Uint32Array.from(socket),
      geom: Float32Array.from(geom),
      points: Float32Array.from(points),
    }),
  };
}

const g = (p: Prims, k: number, i: number) => p.geom[k * GEOM + i] as number;

/** Distance from (`px`, `py`) to the segment `a`–`b`. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len, 0), 1) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

function bar(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  hw: number,
  ends: number,
): number {
  if (ends === ENDS.round) return segment(px, py, x1, y1, x2, y2) - hw;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = len > 0 ? (x2 - x1) / len : 1;
  const uy = len > 0 ? (y2 - y1) / len : 0;
  const along = Math.abs((px - cx) * ux + (py - cy) * uy);
  const across = Math.abs(-(px - cx) * uy + (py - cy) * ux);
  const half = len / 2;
  if (ends === ENDS.square) {
    const qx = along - half;
    const qy = across - hw;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  return Math.max(across - hw, (along + across - (half + hw)) / Math.SQRT2);
}

/** Distance from local (`x`, `y`) to primitive `k`'s edge: below 0 inside. */
/** How far a triangle is shrunk toward its middle. */
const triScale = (p: Prims, k: number, lamp: number) =>
  g(p, k, 6) > 0 ? Math.min(1, Math.max(lamp * TRI_FILL, 0)) : 1;

/** A triangle's corners, its middle, and its inradius at full size. */
function triOf(p: Prims, k: number) {
  const c = [0, 2, 4].map((i) => [g(p, k, i), g(p, k, i + 1)] as const);
  const [a, b, d] = c as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  const mx = (a[0] + b[0] + d[0]) / 3;
  const my = (a[1] + b[1] + d[1]) / 3;
  const area = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1])) / 2;
  const perimeter =
    Math.hypot(b[0] - a[0], b[1] - a[1]) +
    Math.hypot(d[0] - b[0], d[1] - b[1]) +
    Math.hypot(a[0] - d[0], a[1] - d[1]);
  return { c, mx, my, inradius: perimeter > 0 ? (2 * area) / perimeter : 0 };
}

/** Distance from (`x`, `y`) to the triangle `c`'s edge, below 0 inside. */
function triangle(x: number, y: number, c: readonly (readonly [number, number])[]): number {
  let d = Infinity;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = c[i] as readonly [number, number];
    const [bx, by] = c[(i + 1) % 3] as readonly [number, number];
    d = Math.min(d, segment(x, y, ax, ay, bx, by));
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    sign += cross > 0 ? 1 : cross < 0 ? -1 : 0;
  }
  return Math.abs(sign) === 3 ? -d : d;
}

export function sdf(p: Prims, k: number, x: number, y: number, lamp = 1): number {
  switch (p.kind[k]) {
    case PRIM.tri: {
      const t = triOf(p, k);
      const f = triScale(p, k, lamp);
      return triangle(t.mx + (x - t.mx) / f, t.my + (y - t.my) / f, t.c) * f;
    }
    case PRIM.disc:
      return Math.hypot(x - g(p, k, 0), y - g(p, k, 1)) - radiusOfPrim(p, k, lamp);
    case PRIM.bar:
      return bar(x, y, g(p, k, 0), g(p, k, 1), g(p, k, 2), g(p, k, 3), g(p, k, 4), g(p, k, 5));
    case PRIM.poly: {
      const first = g(p, k, 0);
      const count = g(p, k, 1);
      let d = Infinity;
      const pt = (i: number) => p.points[(first + i) * 2] as number;
      const qt = (i: number) => p.points[(first + i) * 2 + 1] as number;
      if (count === 1) d = Math.hypot(x - pt(0), y - qt(0));
      for (let i = 0; i + 1 < count; i++)
        d = Math.min(d, segment(x, y, pt(i), qt(i), pt(i + 1), qt(i + 1)));
      return d - g(p, k, 2);
    }
    default: {
      const r = g(p, k, 4);
      const cx = (g(p, k, 0) + g(p, k, 2)) / 2;
      const cy = (g(p, k, 1) + g(p, k, 3)) / 2;
      const qx = Math.abs(x - cx) - ((g(p, k, 2) - g(p, k, 0)) / 2 - r);
      const qy = Math.abs(y - cy) - ((g(p, k, 3) - g(p, k, 1)) / 2 - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }
  }
}

/** A primitive's thickness from its middle to its edge: a disc's radius, a stroke's half width. */
export function radiusOfPrim(p: Prims, k: number, lamp = 1): number {
  switch (p.kind[k]) {
    case PRIM.tri:
      return triOf(p, k).inradius * triScale(p, k, lamp);
    case PRIM.disc:
      return g(p, k, 2) * (g(p, k, 3) > 0 ? lamp : 1);
    case PRIM.bar:
      return g(p, k, 4);
    case PRIM.poly:
      return g(p, k, 2);
    default:
      return 0;
  }
}

/** How far a primitive's light blooms, as a multiple of an LED's. */
export function glowOfPrim(p: Prims, k: number): number {
  switch (p.kind[k]) {
    case PRIM.tri:
      return g(p, k, 7);
    case PRIM.disc:
      return g(p, k, 4);
    case PRIM.bar:
      return g(p, k, 6);
    case PRIM.poly:
      return g(p, k, 3);
    default:
      return 0;
  }
}

/** A primitive's local bounding box, before any glow. */
export function boxOf(
  p: Prims,
  k: number,
  lamp = 1,
): { x0: number; y0: number; x1: number; y1: number } {
  const r = radiusOfPrim(p, k, lamp);
  switch (p.kind[k]) {
    case PRIM.disc:
      return { x0: g(p, k, 0) - r, y0: g(p, k, 1) - r, x1: g(p, k, 0) + r, y1: g(p, k, 1) + r };
    case PRIM.bar:
      return {
        x0: Math.min(g(p, k, 0), g(p, k, 2)) - r,
        y0: Math.min(g(p, k, 1), g(p, k, 3)) - r,
        x1: Math.max(g(p, k, 0), g(p, k, 2)) + r,
        y1: Math.max(g(p, k, 1), g(p, k, 3)) + r,
      };
    case PRIM.poly:
      return { x0: g(p, k, 4) - r, y0: g(p, k, 5) - r, x1: g(p, k, 6) + r, y1: g(p, k, 7) + r };
    case PRIM.tri: {
      const xs = [g(p, k, 0), g(p, k, 2), g(p, k, 4)];
      const ys = [g(p, k, 1), g(p, k, 3), g(p, k, 5)];
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    default:
      return { x0: g(p, k, 0), y0: g(p, k, 1), x1: g(p, k, 2), y1: g(p, k, 3) };
  }
}
