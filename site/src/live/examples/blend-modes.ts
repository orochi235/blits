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

const COLS = 192;
const ROWS = 84;

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
/** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
const edge = (d: number) => Math.max(0, Math.min(1, 0.5 + (d * ROWS) / 2));

/** A still band of orange across the whole ramp, centered at height `y`. */
const band = (y: number) =>
  patch<Cell, Tint>(0, (_, c) => tint(ORANGE, edge(0.13 - Math.abs(c.y - y))), {
    writes: NAMES,
  });

// The disc passes through the lower half of the top band and the upper half of the bottom one.
const under = band(0.75);
const over = band(0.25);

// A disc of blue between the two bands, its phase taking it from left to right across the ramp.
const SPAN = 1000;
const disc = patch<Cell, Tint>(
  SPAN,
  (phase, c) => {
    const d = Math.hypot((c.x - 0.12 - 0.76 * phase) * (COLS / ROWS), c.y - 0.5);
    return tint(BLUE, edge(0.3 - d));
  },
  { writes: NAMES },
);

/** The base under each cell: black on the left to white on the right. */
const ramp = (c: Cell) => {
  const g = Math.round(255 * c.x);
  return (g << 16) | (g << 8) | g;
};

export default function run(root: HTMLElement): () => void {
  const grid = document.createElement('div');
  grid.className = 'blend-modes';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(SPAN - 1);
  scrub.value = String(SPAN / 2);
  scrub.ariaLabel = 'Where the disc is';
  root.append(grid, scrub);

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

  // Voices lay on in the order they were cued: one band under the disc, the other over it.
  const m = mix<Cell, Tint>(kit<Tint>(MODES), { name: 'blend-modes' });
  m.cue({ patch: under, subjects: cells });
  m.cue({ patch: disc, subjects: cells, freeze: 'after' });
  m.cue({ patch: over, subjects: cells });

  const pose = m.pose();
  // The mix stays at 0. Each frame reads it at the scrubber's time, without moving it.
  let drawn = Number.NaN;
  const stop = loop(m, () => {
    const t = Number(scrub.value);
    if (t === drawn) return;
    drawn = t;
    const at = m.project(t);
    cells.forEach((c, i) => {
      at.probe(c, pose);
      const base = ramp(c);
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
