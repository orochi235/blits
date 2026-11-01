import {
  add,
  color,
  colorBurn,
  colorDodge,
  colorMode,
  darken,
  darkerColor,
  difference,
  divide,
  exclusion,
  type Handle,
  hardLight,
  hardMix,
  hue,
  kit,
  lighten,
  lighterColor,
  linearBurn,
  linearLight,
  luminosity,
  type Mix,
  mix,
  multiply,
  oklab,
  overlay,
  patch,
  pinLight,
  saturation,
  screen,
  softLight,
  subtract,
  toHex,
  transport,
  vividLight,
} from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Cell {
  x: number;
  y: number;
  /** The rows in its grid, so an edge is a pixel wide at any size. */
  rows: number;
  /** The color under it, as 0xrrggbb. */
  base: number;
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
  colorDodge: color(colorDodge()),
  colorBurn: color(colorBurn()),
  exclusion: color(exclusion()),
  subtract: color(subtract()),
  divide: color(divide()),
  linearBurn: color(linearBurn()),
  vividLight: color(vividLight()),
  linearLight: color(linearLight()),
  pinLight: color(pinLight()),
  hardMix: color(hardMix()),
  hue: color(hue()),
  saturation: color(saturation()),
  colorMode: color(colorMode()),
  luminosity: color(luminosity()),
  darkerColor: color(darkerColor()),
  lighterColor: color(lighterColor()),
};
type Mode = keyof typeof MODES;
/** Each mode's color, keyed by name, so a mix may hold any of them. */
type Tint = Record<string, number[] | undefined>;
const NAMES = Object.keys(MODES) as Mode[];
/** The modes whose two crossings differ, because each layer works on what is under it. */
const ORDERED = new Set<Mode>([
  'overlay',
  'softLight',
  'hardLight',
  'difference',
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'hue',
  'saturation',
  'colorMode',
  'luminosity',
]);
const label = (name: Mode) => (ORDERED.has(name) ? `${name} · ordered` : name);

const ORANGE = oklab(0xf08a24);
const BLUE = oklab(0x2f8fd8);
const ASPECT = 48 / 21;
/** One sweep of the disc, out and back, in ms. */
const PERIOD = 5000;

/** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
const edge = (d: number, rows: number) => Math.max(0, Math.min(1, 0.5 + (d * rows) / 2));

// A cell a shape misses writes nothing, so a probe folds no more than it draws.
function tint(rgb: number[], cov: number, modes: readonly Mode[]): Tint {
  const out: Tint = {};
  if (cov === 0) return out;
  const [L = 0, a = 0, b = 0] = rgb;
  const v = [L * cov, a * cov, b * cov, cov];
  for (const n of modes) out[n] = v;
  return out;
}

/** The three layers, written to `modes`: a band under the disc, the disc, and a band over it. */
function layers(m: Mix<Cell, Tint>, cells: Cell[], modes: readonly Mode[]): Handle {
  const band = (y: number) =>
    patch<Cell, Tint>(0, (_, c) => tint(ORANGE, edge(0.13 - Math.abs(c.y - y), c.rows), modes), {
      writes: modes,
    });
  // A disc of blue sweeping out and back across the ramp, eased at each end.
  const disc = patch<Cell, Tint>(
    PERIOD,
    (phase, c) => {
      const x = 0.12 + 0.76 * ((1 - Math.cos(2 * Math.PI * phase)) / 2);
      return tint(BLUE, edge(0.3 - Math.hypot((c.x - x) * ASPECT, c.y - 0.5), c.rows), modes);
    },
    { writes: modes },
  );
  // Voices lay on in the order they were cued: one band under the disc, the other over it.
  m.cue({ patch: band(0.75), subjects: cells });
  const sweep = m.cue({ patch: disc, subjects: cells, loop: true });
  m.cue({ patch: band(0.25), subjects: cells });
  return sweep;
}

/**
 * The base under a cell at `x`: black on the left to white on the right, through muted color in
 * between, since hue and saturation have nothing to keep in a gray.
 */
function ramp(x: number): number {
  const C = 0.09 * Math.sin(Math.PI * x);
  const h = 2.2 + 2.4 * x;
  return toHex([x, C * Math.cos(h), C * Math.sin(h), 1], 0) as number;
}

function grid(cols: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      cells.push({ x: x / (cols - 1), y: y / (rows - 1), rows, base: ramp(x / (cols - 1)) });
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

  const small = grid(48, 21);
  const large = grid(192, 84);

  // The thumbnails' mix holds every mode. The large view's holds only the one it shows, and is
  // made again for each pick, since a probe pays for every channel in its kit. Both run on one
  // transport, whose history keeps two sweeps so the debug panel can seek back through them.
  const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
  const m = mix<Cell, Tint>(kit<Tint>(MODES), { name: 'blend-modes', transport: show });
  const sweep = layers(m, small, NAMES);
  const pose = m.pose();
  let chosen: Mode = 'overlay';
  let one: Mix<Cell, Tint> | undefined;
  let oneSweep: Handle | undefined;
  let onePose: Tint = {};

  // Pausing stops the transport; dragging moves each disc's own voice to that point in its sweep.
  // The slider shows the disc's place: the transport's time, shifted by the last drag.
  let shift = 0;
  const place = () => (((show.now + shift) % PERIOD) + PERIOD) % PERIOD;

  const choose = (name: Mode) => {
    chosen = name;
    caption.textContent = label(name);
    for (const t of thumbs) t.button.ariaPressed = String(t.name === name);
    one?.close();
    one = mix<Cell, Tint>(kit<Tint>({ [name]: MODES[name] }), {
      name: 'blend-modes-large',
      transport: show,
    });
    oneSweep = layers(one, large, [name]);
    oneSweep.seek(place());
    onePose = one.pose();
    drawn = '';
  };
  for (const t of thumbs) t.button.addEventListener('click', () => choose(t.name));

  const showRate = () => {
    play.textContent = show.rate === 0 ? 'Play' : 'Pause';
  };
  play.addEventListener('click', () => {
    show.rate = show.rate === 0 ? 1 : 0;
    showRate();
  });
  scrub.addEventListener('input', () => {
    if (show.rate !== 0) {
      show.rate = 0;
      showRate();
    }
    const to = Number(scrub.value);
    sweep.seek(to);
    oneSweep?.seek(to);
    shift = to - show.now;
  });

  let drawn = '';
  choose(chosen);
  showRate();
  const stop = loop(show, (now) => {
    show.sync(now);
    scrub.value = String(place());
    const key = `${show.seq} ${chosen}`;
    if (key === drawn) return;
    drawn = key;
    small.forEach((c, i) => {
      m.probe(c, pose);
      for (const t of thumbs) put(t.view.image, i, toHex(pose[t.name] as number[], c.base));
    });
    for (const t of thumbs) t.view.ctx.putImageData(t.view.image, 0, 0);
    large.forEach((c, i) => {
      one?.probe(c, onePose);
      put(big.image, i, toHex(onePose[chosen] as number[], c.base));
    });
    big.ctx.putImageData(big.image, 0, 0);
  });

  return () => {
    stop();
    one?.close();
    m.close();
  };
}
