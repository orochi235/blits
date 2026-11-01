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
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Cell {
  x: number;
  y: number;
  /** The rows in its grid, so an edge is a pixel wide at any size. */
  rows: number;
  /** In the large view, which shows only the chosen mode. */
  big: boolean;
}

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
type Tint = Partial<Record<Mode, number[]>>;
const NAMES = Object.keys(MODES) as Mode[];
const ORDERED = new Set<Mode>(['overlay', 'softLight', 'hardLight', 'difference']);
const label = (name: Mode) => (ORDERED.has(name) ? `${name} · ordered` : name);

const ORANGE = oklab(0xf08a24);
const BLUE = oklab(0x2f8fd8);
const ASPECT = 48 / 21;
/** One sweep of the disc, out and back, in ms. */
const PERIOD = 5000;

let chosen: Mode = 'overlay';

/** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
const edge = (d: number, rows: number) => Math.max(0, Math.min(1, 0.5 + (d * rows) / 2));

// A cell a shape misses writes nothing, and a large-view cell writes only the chosen mode, so a
// probe folds no more than it draws.
function tint(rgb: number[], cov: number, c: Cell): Tint {
  const out: Tint = {};
  if (cov === 0) return out;
  const [L = 0, a = 0, b = 0] = rgb;
  const v = [L * cov, a * cov, b * cov, cov];
  if (c.big) out[chosen] = v;
  else for (const n of NAMES) out[n] = v;
  return out;
}

const band = (y: number) =>
  patch<Cell, Tint>(0, (_, c) => tint(ORANGE, edge(0.13 - Math.abs(c.y - y), c.rows), c), {
    writes: NAMES,
  });

// A disc of blue sweeping out and back across the ramp, eased at each end.
const disc = patch<Cell, Tint>(
  PERIOD,
  (phase, c) => {
    const x = 0.12 + 0.76 * ((1 - Math.cos(2 * Math.PI * phase)) / 2);
    return tint(BLUE, edge(0.3 - Math.hypot((c.x - x) * ASPECT, c.y - 0.5), c.rows), c);
  },
  { writes: NAMES },
);

/** The base under each cell: black on the left to white on the right. */
const ramp = (c: Cell) => {
  const g = Math.round(255 * c.x);
  return (g << 16) | (g << 8) | g;
};

function grid(cols: number, rows: number, big: boolean): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells.push({ x: x / (cols - 1), y: y / (rows - 1), rows, big });
  return cells;
}

function canvas(cols: number, rows: number) {
  const el = document.createElement('canvas');
  el.width = cols;
  el.height = rows;
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  return { el, ctx, image: ctx.createImageData(cols, rows) };
}

/** Writes `hex` into `image` at pixel `i`. */
function put(image: ImageData, i: number, hex: number) {
  image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
}

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const big = canvas(192, 84);
  const caption = document.createElement('p');
  caption.className = 'picker-name';
  const strip = document.createElement('div');
  strip.className = 'picker-strip';
  const thumbs = NAMES.map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    const view = canvas(48, 21);
    const text = document.createElement('span');
    text.textContent = name;
    button.append(view.el, text);
    strip.append(button);
    return { name, button, view };
  });
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'switch';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(PERIOD);
  scrub.step = 'any';
  scrub.ariaLabel = 'Where the disc is in its sweep';
  const controls = document.createElement('div');
  controls.className = 'picker-controls';
  controls.append(play, scrub);
  wrap.append(big.el, caption, strip, controls);
  root.append(wrap);

  const small = grid(48, 21, false);
  const large = grid(192, 84, true);
  const cells = [...small, ...large];

  // History keeps two sweeps, so the debug panel can seek back through them.
  const m = mix<Cell, Tint>(kit<Tint>(MODES), {
    name: 'blend-modes',
    history: { ms: 2 * PERIOD, tape: createHistory },
  });
  // Voices lay on in the order they were cued: one band under the disc, the other over it.
  m.cue({ patch: band(0.75), subjects: cells });
  const sweep = m.cue({ patch: disc, subjects: cells, loop: true });
  m.cue({ patch: band(0.25), subjects: cells });
  const pose = m.pose();

  const choose = (name: Mode) => {
    chosen = name;
    caption.textContent = label(name);
    for (const t of thumbs) t.button.ariaPressed = String(t.name === name);
    drawn = '';
  };
  for (const t of thumbs) t.button.addEventListener('click', () => choose(t.name));

  const showRate = () => {
    play.textContent = m.rate === 0 ? 'Play' : 'Pause';
  };
  // Pausing stops the mix's clock; dragging moves the disc's own voice to that point in its
  // sweep. The slider shows the disc's place: the mix's time, shifted by the last drag.
  let shift = 0;
  play.addEventListener('click', () => {
    m.rate = m.rate === 0 ? 1 : 0;
    showRate();
  });
  scrub.addEventListener('input', () => {
    if (m.rate !== 0) {
      m.rate = 0;
      showRate();
    }
    const to = Number(scrub.value);
    sweep.seek(to);
    shift = to - m.now;
  });

  let drawn = '';
  choose(chosen);
  showRate();
  const stop = loop(m, (now) => {
    m.sync(now);
    scrub.value = String((((m.now + shift) % PERIOD) + PERIOD) % PERIOD);
    const key = `${m.seq} ${chosen}`;
    if (key === drawn) return;
    drawn = key;
    small.forEach((c, i) => {
      m.probe(c, pose);
      const base = ramp(c);
      for (const t of thumbs) put(t.view.image, i, toHex(pose[t.name] as number[], base));
    });
    for (const t of thumbs) t.view.ctx.putImageData(t.view.image, 0, 0);
    large.forEach((c, i) => {
      m.probe(c, pose);
      put(big.image, i, toHex(pose[chosen] as number[], ramp(c)));
    });
    big.ctx.putImageData(big.image, 0, 0);
  });

  return () => {
    stop();
    m.close();
  };
}
