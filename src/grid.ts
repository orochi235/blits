/**
 * Positions side by side, `axes` numbers a place, `x`, then `y` and `z` where there are, and a
 * uniform grid over `x` and `y` built again at the first query after they move, so a ball finds the
 * places within it without visiting the rest. On 3 axes a cell holds every `z`, which the distance
 * test reads.
 */
export class Grid {
  xy: Float64Array = new Float64Array(0);
  /** Numbers a place: 1, 2 or 3. */
  axes = 2;
  /** How many places the list had. */
  n = 0;
  /** The cell size asked for, NaN for one from the spread; the grid widens it where the positions are spread too thin. */
  cell = Number.NaN;
  dirty = true;
  /** The grid as last built: its origin, cell size and shape. */
  x0 = 0;
  y0 = 0;
  size = 1;
  cols = 0;
  rows = 0;
  /** By cell, where its entries start in `order`, one past the last cell included. */
  starts = new Int32Array(1);
  order = new Int32Array(0);
  /** By place, the cell the last build put it in, -1 for none. */
  home = new Int32Array(0);
  /**
   * Places `put` moved out of their cell since the last build, which every query tests on their own
   * and skips in the cells, and by place whether it is one. Past a sixteenth of the places, the grid
   * is built again.
   */
  strays: number[] = [];
  stray = new Uint8Array(0);
  /** What the last `query` or `ring` found, the first `count` of it. */
  found = new Int32Array(64);
  count = 0;

  /**
   * Moves place `i` to (`x`, `y`, `z`) in `xy`, as many of them as there are axes, leaving the grid as
   * it is where the place keeps its cell.
   */
  put(i: number, x: number, y: number, z: number): void {
    const a = this.axes;
    this.xy[a * i] = x;
    if (a > 1) this.xy[a * i + 1] = y;
    if (a > 2) this.xy[a * i + 2] = z;
    if (this.dirty) return;
    if (this.cols === 0 || i >= this.home.length) {
      this.dirty = true;
      return;
    }
    const col = Math.floor((x - this.x0) / this.size);
    const row = a === 1 ? 0 : Math.floor((y - this.y0) / this.size);
    const c =
      col >= 0 && col < this.cols && row >= 0 && row < this.rows ? row * this.cols + col : -2;
    if (c === this.home[i] || this.stray[i] === 1) return;
    this.stray[i] = 1;
    this.strays.push(i);
    if (this.strays.length > Math.max(32, this.n >> 4)) this.dirty = true;
  }

  private build(): void {
    this.dirty = false;
    for (const i of this.strays) this.stray[i] = 0;
    this.strays.length = 0;
    const xy = this.xy;
    const a = this.axes;
    const n = Math.min(this.n, Math.floor(xy.length / a));
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const x = xy[a * i] as number;
      const y = a > 1 ? (xy[a * i + 1] as number) : 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!(x1 >= x0) || !(y1 >= y0)) {
      this.cols = 0;
      this.rows = 0;
      return;
    }
    // Unasked, about two subjects a cell where they are spread evenly.
    let size = !Number.isNaN(this.cell)
      ? this.cell
      : a === 1
        ? (2 * Math.max(x1 - x0, 1e-9)) / n
        : Math.sqrt((2 * Math.max(x1 - x0, 1e-9) * Math.max(y1 - y0, 1e-9)) / n);
    // At most about four cells a subject: a few far-flung positions would otherwise ask for millions.
    const most = 4 * n + 64;
    if ((Math.floor((x1 - x0) / size) + 1) * (Math.floor((y1 - y0) / size) + 1) > most)
      size = Math.max(size, Math.sqrt(((x1 - x0) * (y1 - y0)) / n), (x1 - x0 + y1 - y0) / most);
    const cols = Math.floor((x1 - x0) / size) + 1;
    const rows = Math.floor((y1 - y0) / size) + 1;
    this.x0 = x0;
    this.y0 = y0;
    this.size = size;
    this.cols = cols;
    this.rows = rows;
    const cells = cols * rows;
    if (this.starts.length < cells + 1) this.starts = new Int32Array(cells + 1);
    else this.starts.fill(0, 0, cells + 1);
    if (this.order.length < n) this.order = new Int32Array(n);
    if (this.home.length < n) {
      this.home = new Int32Array(n);
      this.stray = new Uint8Array(n);
    }
    const starts = this.starts;
    const order = this.order;
    // A position that is not a number is in no cell, and no ball finds it.
    for (let i = 0; i < n; i++) {
      const c = cellOf(xy, a, i, x0, y0, size, cols);
      this.home[i] = c;
      if (c >= 0) starts[c + 1] = (starts[c + 1] as number) + 1;
    }
    for (let c = 0; c < cells; c++)
      starts[c + 1] = (starts[c + 1] as number) + (starts[c] as number);
    const placed = starts[cells] as number;
    // Filled from each cell's end back to its start: `starts[c + 1]`, the end of cell c, ends at its start.
    for (let i = n - 1; i >= 0; i--) {
      const c = cellOf(xy, a, i, x0, y0, size, cols);
      if (c < 0) continue;
      const k = (starts[c + 1] as number) - 1;
      starts[c + 1] = k;
      order[k] = i;
    }
    for (let c = 0; c < cells; c++) starts[c] = starts[c + 1] as number;
    starts[cells] = placed;
  }

  private push(i: number, count: number): number {
    if (count === this.found.length) {
      const grown = new Int32Array(this.found.length * 2);
      grown.set(this.found);
      this.found = grown;
    }
    this.found[count] = i;
    return count + 1;
  }

  /** The squared distance from place `i` to (`cx`, `cy`, `cz`), over the axes there are. */
  d2(i: number, cx: number, cy: number, cz: number): number {
    const a = this.axes;
    const xy = this.xy;
    if (a === 2) {
      const dx = (xy[2 * i] as number) - cx;
      const dy = (xy[2 * i + 1] as number) - cy;
      return dx * dx + dy * dy;
    }
    const dx = (xy[a * i] as number) - cx;
    if (a === 1) return dx * dx;
    const dy = (xy[a * i + 1] as number) - cy;
    const dz = (xy[a * i + 2] as number) - cz;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Leaves in `found` the places within `r` of (`x`, `y`, `z`), by the test `inside` makes, `r2`
   * being `r * r`: the cells the ball touches, and one more where an edge falls a hair from one. An
   * axis past those there are is not read.
   */
  query(x: number, y: number, z: number, r: number, r2: number): number {
    if (this.dirty) this.build();
    this.count = 0;
    if (this.cols === 0 || !(r >= 0)) return 0;
    const cy = this.axes === 1 ? 0 : y;
    const size = this.size;
    const c0 = Math.max(0, edge((x - r - this.x0) / size, -1));
    const c1 = Math.min(this.cols - 1, edge((x + r - this.x0) / size, 1));
    const r0 = Math.max(0, edge((cy - r - this.y0) / size, -1));
    const r1 = Math.min(this.rows - 1, edge((cy + r - this.y0) / size, 1));
    const order = this.order;
    const starts = this.starts;
    const any = this.strays.length > 0;
    const flat = this.axes === 2;
    const xy = this.xy;
    let count = 0;
    for (let row = r0; row <= r1 && c0 <= c1; row++) {
      const from = starts[row * this.cols + c0] as number;
      const to = starts[row * this.cols + c1 + 1] as number;
      for (let k = from; k < to; k++) {
        const i = order[k] as number;
        if (any && this.stray[i] === 1) continue;
        if (flat) {
          const dx = (xy[2 * i] as number) - x;
          const dy = (xy[2 * i + 1] as number) - cy;
          if (dx * dx + dy * dy <= r2) count = this.push(i, count);
        } else if (this.d2(i, x, cy, z) <= r2) count = this.push(i, count);
      }
    }
    for (const i of this.strays) if (this.d2(i, x, cy, z) <= r2) count = this.push(i, count);
    this.count = count;
    return count;
  }

  /**
   * Leaves in `found` the places beyond `r` of (`x`, `y`, `z`) and within a cell's width more, from
   * the cells that ring touches.
   */
  ring(x: number, y: number, z: number, r: number): number {
    if (this.dirty) this.build();
    this.count = 0;
    if (this.cols === 0 || !(r >= 0)) return 0;
    const a = this.axes;
    const cy = a === 1 ? 0 : y;
    const size = this.size;
    const out = r + size;
    const r2 = r * r;
    const out2 = out * out;
    const c0 = Math.max(0, Math.floor((x - out - this.x0) / size));
    const c1 = Math.min(this.cols - 1, Math.floor((x + out - this.x0) / size));
    const r0 = Math.max(0, Math.floor((cy - out - this.y0) / size));
    const r1 = Math.min(this.rows - 1, Math.floor((cy + out - this.y0) / size));
    let count = 0;
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        // A cell wholly inside the ball holds nothing beyond it; on 3 axes a cell holds every z.
        if (a < 3) {
          const ax = this.x0 + col * size - x;
          const ay = this.y0 + row * size - cy;
          const farY = a === 1 ? 0 : Math.max(ay * ay, (ay + size) ** 2);
          if (Math.max(ax * ax, (ax + size) ** 2) + farY <= r2) continue;
        }
        const c = row * this.cols + col;
        for (let k = this.starts[c] as number; k < (this.starts[c + 1] as number); k++) {
          const i = this.order[k] as number;
          if (this.stray[i] === 1) continue;
          const d2 = this.d2(i, x, cy, z);
          if (d2 > r2 && d2 <= out2) count = this.push(i, count);
        }
      }
    for (const i of this.strays) {
      const d2 = this.d2(i, x, cy, z);
      if (d2 > r2 && d2 <= out2) count = this.push(i, count);
    }
    this.count = count;
    return count;
  }
}

function cellOf(
  xy: Float64Array,
  a: number,
  i: number,
  x0: number,
  y0: number,
  size: number,
  cols: number,
): number {
  const x = xy[a * i] as number;
  const y = a > 1 ? (xy[a * i + 1] as number) : 0;
  if (!(x >= x0) || !(y >= y0)) return -1;
  return Math.floor((x - x0) / size) + Math.floor((y - y0) / size) * cols;
}

/** The cell index `u` falls in, one further out toward `side` where it lies within 1e-6 of an edge. */
function edge(u: number, side: number): number {
  const c = Math.floor(u);
  if (side < 0) return u - c < 1e-6 ? c - 1 : c;
  return c + 1 - u < 1e-6 ? c + 1 : c;
}
