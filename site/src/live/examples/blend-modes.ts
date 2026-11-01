import {
  add,
  type Channel,
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

interface Cell {
  x: number;
  y: number;
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
const SPAN = 1000;

/** The base under each cell: black on the left to white on the right. */
const ramp = (c: Cell) => {
  const g = Math.round(255 * c.x);
  return (g << 16) | (g << 8) | g;
};

/**
 * A mix of `modes` over a `cols` by `rows` grid: an orange band under a blue disc and another over
 * it, the disc moved across by the time the mix is read at. Every voice writes each mode's channel,
 * so each mode folds the same three layers.
 */
function scene(modes: Mode[], cols: number, rows: number) {
  /** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
  const edge = (d: number) => Math.max(0, Math.min(1, 0.5 + (d * rows) / 2));
  // A cell a shape misses writes nothing, so it adds nothing to fold.
  const tint = (rgb: number[], cov: number): Tint => {
    const out: Tint = {};
    if (cov === 0) return out;
    const [L = 0, a = 0, b = 0] = rgb;
    const v = [L * cov, a * cov, b * cov, cov];
    for (const n of modes) out[n] = v;
    return out;
  };
  const band = (y: number) =>
    patch<Cell, Tint>(0, (_, c) => tint(ORANGE, edge(0.13 - Math.abs(c.y - y))), {
      writes: modes,
    });
  const disc = patch<Cell, Tint>(
    SPAN,
    (phase, c) =>
      tint(BLUE, edge(0.3 - Math.hypot((c.x - 0.12 - 0.76 * phase) * ASPECT, c.y - 0.5))),
    { writes: modes },
  );

  const cells: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells.push({ x: x / (cols - 1), y: y / (rows - 1) });

  const channels = Object.fromEntries(modes.map((n) => [n, MODES[n]])) as Record<
    Mode,
    Channel<number[]>
  >;
  // Voices lay on in the order they were cued: one band under the disc, the other over it.
  const m = mix<Cell, Tint>(kit<Tint>(channels));
  m.cue({ patch: band(0.75), subjects: cells });
  m.cue({ patch: disc, subjects: cells, freeze: 'after' });
  m.cue({ patch: band(0.25), subjects: cells });
  const pose = m.pose();

  /** Paints each mode's take on the scene at time `t` into its image. */
  const paint = (t: number, images: Partial<Record<Mode, ImageData>>) => {
    const at = m.project(t);
    cells.forEach((c, i) => {
      at.probe(c, pose);
      const base = ramp(c);
      for (const n of modes) {
        const hex = toHex(pose[n] as number[], base);
        (images[n] as ImageData).data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
      }
    });
  };
  return { paint, close: () => m.close() };
}

function canvas(cols: number, rows: number) {
  const el = document.createElement('canvas');
  el.width = cols;
  el.height = rows;
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  return { el, ctx, image: ctx.createImageData(cols, rows) };
}

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'blend-modes';

  const big = canvas(192, 84);
  const caption = document.createElement('p');
  caption.className = 'blend-modes-name';
  const strip = document.createElement('div');
  strip.className = 'blend-modes-strip';

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

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(SPAN - 1);
  scrub.value = String(SPAN / 2);
  scrub.step = 'any';
  scrub.ariaLabel = 'Where the disc is';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'switch';
  const controls = document.createElement('div');
  controls.className = 'blend-modes-controls';
  controls.append(play, scrub);
  wrap.append(big.el, caption, strip, controls);
  root.append(wrap);

  // Thumbnails come from one small mix of every mode; the large view from a mix of the chosen one.
  const all = scene(NAMES, 48, 21);
  let chosen: Mode = 'overlay';
  let one = scene([chosen], 192, 84);
  let drawn = Number.NaN;

  const choose = (name: Mode) => {
    chosen = name;
    one.close();
    one = scene([name], 192, 84);
    caption.textContent = label(name);
    for (const t of thumbs) t.button.ariaPressed = String(t.name === name);
    drawn = Number.NaN;
  };
  for (const t of thumbs) t.button.addEventListener('click', () => choose(t.name));
  choose(chosen);

  const images = Object.fromEntries(thumbs.map((t) => [t.name, t.view.image])) as Record<
    Mode,
    ImageData
  >;
  // Playing, the disc sweeps out and back once every PERIOD ms, eased at each end; dragging the
  // slider pauses it, and play resumes from wherever the slider was left.
  const PERIOD = 5000;
  let playing = true;
  let angle = Math.PI / 2;
  let last = Number.NaN;
  const setPlaying = (on: boolean) => {
    playing = on;
    play.textContent = on ? 'Pause' : 'Play';
    if (on) angle = Math.acos(1 - (2 * Number(scrub.value)) / SPAN);
  };
  play.addEventListener('click', () => setPlaying(!playing));
  scrub.addEventListener('input', () => setPlaying(false));
  setPlaying(true);

  // The mixes stay at 0. Each redraw reads them at the slider's time, without moving them.
  const stop = loop({ rebase: () => {} }, (now) => {
    // A step is capped, so the time the window was away doesn't count.
    const dt = Number.isNaN(last) ? 0 : Math.min(100, now - last);
    last = now;
    if (playing) {
      angle += (2 * Math.PI * dt) / PERIOD;
      scrub.value = String(((1 - Math.cos(angle)) / 2) * (SPAN - 1));
    }
    const t = Number(scrub.value);
    if (t === drawn) return;
    drawn = t;
    all.paint(t, images);
    for (const th of thumbs) th.view.ctx.putImageData(th.view.image, 0, 0);
    one.paint(t, { [chosen]: big.image });
    big.ctx.putImageData(big.image, 0, 0);
  });

  return () => {
    stop();
    all.close();
    one.close();
  };
}
