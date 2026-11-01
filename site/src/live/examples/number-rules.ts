import { kit, last, max, min, mix, mul, norm, patch, screen, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Cell {
  x: number;
  y: number;
  /** In the large view, which shows only the chosen rule. */
  big: boolean;
}

const RULES = {
  sum: sum(),
  mul: mul(),
  max: max(),
  min: min(),
  'norm(2)': norm(),
  'norm(4)': norm({ power: 4 }),
  screen: screen(),
  last: last<number>(),
};
type Rule = keyof typeof RULES;
type Values = Partial<Record<Rule, number>>;
const NAMES = Object.keys(RULES) as Rule[];

const ASPECT = 48 / 21;
/** One sweep of the disc, out and back, in ms. */
const PERIOD = 5000;
/** The numbers the three voices write: the bottom band, the disc, and the top band. */
const UNDER = 0.5;
const DISC = 0.9;
const OVER = 0.7;

let chosen: Rule = 'norm(2)';

// A cell a shape misses writes nothing, and a large-view cell writes only the chosen rule, so a
// probe folds no more than it draws.
function write(value: number, inside: boolean, c: Cell): Values {
  const out: Values = {};
  if (!inside) return out;
  if (c.big) out[chosen] = value;
  else for (const n of NAMES) out[n] = value;
  return out;
}

const band = (y: number, value: number) =>
  patch<Cell, Values>(0, (_, c) => write(value, Math.abs(c.y - y) < 0.13, c), { writes: NAMES });

// A disc sweeping out and back across the tile, eased at each end.
const disc = patch<Cell, Values>(
  PERIOD,
  (phase, c) => {
    const x = 0.12 + 0.76 * ((1 - Math.cos(2 * Math.PI * phase)) / 2);
    return write(DISC, Math.hypot((c.x - x) * ASPECT, c.y - 0.5) < 0.3, c);
  },
  { writes: NAMES },
);

/** The color scale, 0 to 2, lighter all the way up: near black, through purple and red, to pale yellow. */
const STOPS = [0x000004, 0x3b0f70, 0x8c2981, 0xde4968, 0xfe9f6d, 0xfcfdbf];
const NONE = 0x3a3a44;
function shade(v: number | undefined): number {
  if (v === undefined) return NONE;
  const t = (Math.max(0, Math.min(2, v)) / 2) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const u = t - i;
  const a = STOPS[i] as number;
  const b = STOPS[i + 1] as number;
  let out = 0;
  for (const s of [16, 8, 0]) {
    const ca = (a >> s) & 0xff;
    const cb = (b >> s) & 0xff;
    out |= Math.round(ca + (cb - ca) * u) << s;
  }
  return out;
}

function grid(cols: number, rows: number, big: boolean): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells.push({ x: x / (cols - 1), y: y / (rows - 1), big });
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

  const scale = document.createElement('div');
  scale.className = 'picker-scale';
  const bar = canvas(160, 1);
  for (let i = 0; i < 160; i++) put(bar.image, i, shade((2 * i) / 159));
  bar.ctx.putImageData(bar.image, 0, 0);
  const ticks = document.createElement('div');
  for (const t of ['0', '1', '2']) {
    const tick = document.createElement('span');
    tick.textContent = t;
    ticks.append(tick);
  }
  scale.append(bar.el, ticks);

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
  wrap.append(big.el, caption, scale, strip, controls);
  root.append(wrap);

  const small = grid(48, 21, false);
  const large = grid(192, 84, true);
  const cells = [...small, ...large];

  // History keeps two sweeps, so the debug panel can seek back through them.
  const m = mix<Cell, Values>(kit<Values>(RULES), {
    name: 'number-rules',
    history: { ms: 2 * PERIOD, tape: createHistory },
  });
  // Cued in this order, so `last` shows the top band over the disc over the bottom band.
  m.cue({ patch: band(0.7, UNDER), subjects: cells });
  const sweep = m.cue({ patch: disc, subjects: cells, loop: true });
  m.cue({ patch: band(0.3, OVER), subjects: cells });
  const pose = m.pose();

  const choose = (name: Rule) => {
    chosen = name;
    caption.textContent = name;
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
      for (const t of thumbs) put(t.view.image, i, shade(pose[t.name]));
    });
    for (const t of thumbs) t.view.ctx.putImageData(t.view.image, 0, 0);
    large.forEach((c, i) => {
      m.probe(c, pose);
      put(big.image, i, shade(pose[chosen]));
    });
    big.ctx.putImageData(big.image, 0, 0);
  });

  return () => {
    stop();
    m.close();
  };
}
