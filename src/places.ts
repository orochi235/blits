/**
 * Where the host says each subject is: a list of subjects and their positions side by side, `x` then
 * `y`, and a uniform grid over them built again at the first query after they move, so a bound
 * finds the subjects within it without visiting the rest.
 */
export class Places<I> {
  list: readonly I[] = [];
  xy: Float64Array = new Float64Array(0);
  /** The cell size asked for; the grid widens it where the positions are spread too thin. */
  cell = 1;
  /** By subject, its place in `list`. */
  readonly at = new Map<I, number>();
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
  /** What the last `query` found, the first `count` of it. */
  found = new Int32Array(64);
  count = 0;

  /** Takes the host's subjects and positions; `xy` is read in place, so a move needs only `moved`. */
  set(list: readonly I[], xy: Float64Array, cell: number): void {
    if (list !== this.list) {
      this.at.clear();
      for (let i = 0; i < list.length; i++) this.at.set(list[i] as I, i);
      this.list = list;
    }
    this.xy = xy;
    this.cell = cell;
    this.dirty = true;
  }

  private build(): void {
    this.dirty = false;
    const xy = this.xy;
    const n = Math.min(this.list.length, xy.length >> 1);
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const x = xy[2 * i] as number;
      const y = xy[2 * i + 1] as number;
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
    // At most about four cells a subject: a few far-flung positions would otherwise ask for millions.
    let size = this.cell;
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
    const starts = this.starts;
    const order = this.order;
    // A position that is not a number is in no cell, and no bound finds it.
    for (let i = 0; i < n; i++) {
      const c = cellOf(xy, i, x0, y0, size, cols);
      if (c >= 0) starts[c + 1] = (starts[c + 1] as number) + 1;
    }
    for (let c = 0; c < cells; c++)
      starts[c + 1] = (starts[c + 1] as number) + (starts[c] as number);
    const placed = starts[cells] as number;
    // Filled from each cell's end back to its start: `starts[c + 1]`, the end of cell c, ends at its start.
    for (let i = n - 1; i >= 0; i--) {
      const c = cellOf(xy, i, x0, y0, size, cols);
      if (c < 0) continue;
      const k = (starts[c + 1] as number) - 1;
      starts[c + 1] = k;
      order[k] = i;
    }
    for (let c = 0; c < cells; c++) starts[c] = starts[c + 1] as number;
    starts[cells] = placed;
  }

  /**
   * Leaves in `found` the entries within `r` of (`cx`, `cy`), by the test `inside` makes, `r2`
   * being `r * r`: the cells the circle touches, and one more where an edge falls a hair from one.
   */
  query(cx: number, cy: number, r: number, r2: number): number {
    if (this.dirty) this.build();
    this.count = 0;
    if (this.cols === 0 || !(r >= 0)) return 0;
    const size = this.size;
    const c0 = edge(Math.max(0, (cx - r - this.x0) / size), -1);
    const c1 = Math.min(this.cols - 1, edge((cx + r - this.x0) / size, 1));
    const r0 = edge(Math.max(0, (cy - r - this.y0) / size), -1);
    const r1 = Math.min(this.rows - 1, edge((cy + r - this.y0) / size, 1));
    if (c1 < Math.max(0, c0) || r1 < Math.max(0, r0)) return 0;
    const xy = this.xy;
    const order = this.order;
    const starts = this.starts;
    let found = this.found;
    let count = 0;
    for (let row = Math.max(0, r0); row <= r1; row++) {
      const from = starts[row * this.cols + Math.max(0, c0)] as number;
      const to = starts[row * this.cols + c1 + 1] as number;
      for (let k = from; k < to; k++) {
        const i = order[k] as number;
        const dx = (xy[2 * i] as number) - cx;
        const dy = (xy[2 * i + 1] as number) - cy;
        if (!(dx * dx + dy * dy <= r2)) continue;
        if (count === found.length) {
          const grown = new Int32Array(found.length * 2);
          grown.set(found);
          found = grown;
          this.found = grown;
        }
        found[count++] = i;
      }
    }
    this.count = count;
    return count;
  }

  /** Whether `subject` is within `r` of (`cx`, `cy`), by the same test `query` makes. */
  inside(subject: I, cx: number, cy: number, r2: number): boolean {
    const i = this.at.get(subject);
    if (i === undefined || 2 * i + 1 >= this.xy.length) return false;
    const dx = (this.xy[2 * i] as number) - cx;
    const dy = (this.xy[2 * i + 1] as number) - cy;
    return dx * dx + dy * dy <= r2;
  }
}

function cellOf(
  xy: Float64Array,
  i: number,
  x0: number,
  y0: number,
  size: number,
  cols: number,
): number {
  const x = xy[2 * i] as number;
  const y = xy[2 * i + 1] as number;
  if (!(x >= x0) || !(y >= y0)) return -1;
  return Math.floor((x - x0) / size) + Math.floor((y - y0) / size) * cols;
}

/** The cell index `u` falls in, one further out toward `side` where it lies within 1e-6 of an edge. */
function edge(u: number, side: number): number {
  const c = Math.floor(u);
  if (side < 0) return u - c < 1e-6 ? c - 1 : c;
  return c + 1 - u < 1e-6 ? c + 1 : c;
}
