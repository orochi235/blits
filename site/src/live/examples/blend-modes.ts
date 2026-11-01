import {
  add,
  color,
  darken,
  difference,
  hardLight,
  kit,
  lighten,
  mix,
  multiply,
  oklab,
  overlay,
  patch,
  screen,
  softLight,
  toHex,
} from '@msb235/blits';
import { loop } from '../loop';

const COLS = 48;
const ROWS = 21;

interface Cell {
  x: number;
  y: number;
}

// One channel per mode. Every voice writes all of them, so each tile shows one mode's take on the
// same two layers.
const MODES = {
  'no mode': color(),
  multiply: color(multiply()),
  screen: color(screen()),
  add: color(add()),
  lighten: color(lighten()),
  darken: color(darken()),
  overlay: color(overlay()),
  softLight: color(softLight()),
  hardLight: color(hardLight()),
  difference: color(difference()),
};
type Mode = keyof typeof MODES;
type Tint = Record<Mode, number[]>;
const NAMES = Object.keys(MODES) as Mode[];
const ORDERED = new Set<Mode>(['overlay', 'softLight', 'hardLight', 'difference']);

/** Every mode's channel holding one OKLab color `rgb` at coverage `cov`. */
function tint(rgb: number[], cov: number): Tint {
  const [L = 0, a = 0, b = 0] = rgb;
  const v = [L * cov, a * cov, b * cov, cov];
  return Object.fromEntries(NAMES.map((n) => [n, v])) as Tint;
}

const ORANGE = oklab(0xf08a24);
const BLUE = oklab(0x2f8fd8);
const soft = (d: number) => Math.max(0, Math.min(1, d));

// A band of orange across the whole ramp, still.
const band = patch<Cell, Tint>(0, (_, c) => tint(ORANGE, soft(1 - Math.abs(c.y - 0.38) * 5)), {
  writes: NAMES,
});

// A disc of blue sweeping back and forth across the ramp, overlapping the band's lower half.
const disc = patch<Cell, Tint>(
  5000,
  (phase, c) => {
    const cx = 0.5 - 0.38 * Math.cos(2 * Math.PI * phase);
    const d = Math.hypot((c.x - cx) * (COLS / ROWS), c.y - 0.62);
    return tint(BLUE, soft((0.36 - d) * 8));
  },
  { writes: NAMES },
);

/** The base under each cell: black on the left to white on the right. */
const under = (c: Cell) => {
  const g = Math.round(255 * c.x);
  return (g << 16) | (g << 8) | g;
};

export default function run(root: HTMLElement): () => void {
  const grid = document.createElement('div');
  grid.className = 'blend-modes';
  const swap = document.createElement('button');
  swap.className = 'switch';
  swap.textContent = 'Put the band on top';
  root.append(swap, grid);

  const tiles = NAMES.map((name) => {
    const fig = document.createElement('figure');
    const canvas = document.createElement('canvas');
    canvas.width = COLS;
    canvas.height = ROWS;
    const label = document.createElement('figcaption');
    label.textContent = ORDERED.has(name) ? `${name} · ordered` : name;
    fig.append(canvas, label);
    grid.append(fig);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { name, canvas, ctx, image: ctx.createImageData(COLS, ROWS) };
  });

  const cells: Cell[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) cells.push({ x: x / (COLS - 1), y: y / (ROWS - 1) });

  // Voices lay on in the order they were cued. The band is cued twice, below and above the disc,
  // and the swap moves weight from one copy to the other, so the disc never restarts.
  const m = mix<Cell, Tint>(kit<Tint>(MODES), { name: 'blend-modes' });
  const below = m.cue({ patch: band, subjects: cells });
  m.cue({ patch: disc, subjects: cells, loop: true });
  const above = m.cue({ patch: band, subjects: cells, weight: 0 });

  let flipped = false;
  swap.addEventListener('click', () => {
    flipped = !flipped;
    swap.textContent = flipped ? 'Put the band underneath' : 'Put the band on top';
  });

  let u = 0;
  let last = Number.NaN;
  const pose = m.pose();
  const stop = loop(m, (now) => {
    const dt = Number.isNaN(last) ? 0 : now - last;
    last = now;
    u += ((flipped ? 1 : 0) - u) * Math.min(1, dt / 200);
    below.weight = 1 - u;
    above.weight = u;
    m.sync(now);
    cells.forEach((c, i) => {
      m.probe(c, pose);
      const base = under(c);
      for (const t of tiles) {
        const hex = toHex(pose[t.name], base);
        t.image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
      }
    });
    for (const t of tiles) t.ctx.putImageData(t.image, 0, 0);
  });

  return () => {
    stop();
    m.close();
  };
}
