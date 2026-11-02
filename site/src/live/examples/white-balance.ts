import {
  color,
  divide,
  type Handle,
  kit,
  mix,
  multiply,
  oklab,
  patch,
  toHex,
  transport,
} from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Cell {
  x: number;
  y: number;
  base: number;
}
interface Balance {
  cast?: number[];
  fix?: number[];
}

// The light's color multiplies the scene; the correction divides by the same color, undoing it.
const BALANCE = kit<Balance>({ cast: color(multiply()), fix: color(divide()) });

const COLS = 144;
const ROWS = 72;
const ASPECT = COLS / ROWS;
const NONE = [0, 0, 0, 0];
/** One drift of the light, warm to cool and back, in ms. */
const PERIOD = 10000;
const GRAY = 0x808080;

/** A still life: a wall, a table, a gray card half white, an apple, a lime and a blue mug. */
function scene(x: number, y: number): number {
  const at = (cx: number, cy: number, r: number) => Math.hypot((x - cx) * ASPECT, y - cy) < r;
  if (x > 0.1 && x < 0.26 && y > 0.22 && y < 0.7) return y < 0.46 ? 0xf2f2f2 : GRAY;
  if (at(0.47, 0.62, 0.16)) return 0xc8302a;
  if (at(0.64, 0.68, 0.1)) return 0x7cb342;
  if (x > 0.76 && x < 0.9 && y > 0.4 && y < 0.78) return 0x2f5fb0;
  return y > 0.72 ? 0x8a7a68 : 0xc4c0b8;
}

const CELLS: Cell[] = [];
for (let y = 0; y < ROWS; y++)
  for (let x = 0; x < COLS; x++) {
    const u = x / (COLS - 1);
    const v = y / (ROWS - 1);
    CELLS.push({ x: u, y: v, base: scene(u, v) });
  }

const WARM = oklab(0xffb36b);
const COOL = oklab(0x9fbfff);
/** The light's color `phase` of the way through its drift: warm, then cool, then warm again. */
function light(phase: number): number[] {
  const u = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return WARM.map((w, i) => w + ((COOL[i] as number) - w) * u);
}
const cast = patch<Cell, Balance>(PERIOD, (phase) => ({ cast: light(phase) }), {
  writes: ['cast'],
});
const fix = patch<Cell, Balance>(PERIOD, (phase) => ({ fix: light(phase) }), {
  writes: ['fix'],
});

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** The gray card as `shown`: its color, and its OKLab chroma, how far it is from gray. */
function reading(shown: number): string {
  const [, a = 0, b = 0] = oklab(shown);
  return `gray card ${hex(shown)}  chroma ${Math.hypot(a, b).toFixed(3)}`;
}

function put(image: ImageData, i: number, rgb: number) {
  image.data.set([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff, 255], i * 4);
}

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  // The same scene twice, from one probe a cell: under the light alone, and with the correction
  // laid over it too.
  const view = (title: string) => {
    const fig = document.createElement('figure');
    const el = document.createElement('canvas');
    el.width = COLS;
    el.height = ROWS;
    const caption = document.createElement('figcaption');
    caption.textContent = title;
    const read = document.createElement('p');
    read.className = 'rig-read';
    fig.append(el, caption, read);
    const ctx = el.getContext('2d') as CanvasRenderingContext2D;
    return { fig, ctx, image: ctx.createImageData(COLS, ROWS), read };
  };
  const lightOnly = view('under the light');
  const corrected = view('corrected');
  const pair = document.createElement('div');
  pair.className = 'rig-pair';
  pair.append(lightOnly.fig, corrected.fig);
  const slider = (label: string, value: number) => {
    const row = document.createElement('label');
    row.className = 'rig-row';
    const tag = document.createElement('span');
    tag.className = 'rig-label';
    tag.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(value);
    row.append(tag, input);
    return { row, input };
  };
  const castWeight = slider('Cast weight', 1);
  const fixWeight = slider('Correction weight', 0.5);
  const controls = document.createElement('div');
  controls.className = 'rig-row';
  const play = document.createElement('button');
  play.type = 'button';
  controls.append(play);
  wrap.append(pair, castWeight.row, fixWeight.row, controls);
  root.append(wrap);

  // Both voices loop on one period, cued together, so the correction divides by the very color
  // the cast multiplies by, whichever way the light has drifted. Their weights are the sliders.
  const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
  const m = mix<Cell, Balance>(BALANCE, {
    name: 'white-balance',
    transport: show,
  });
  const lit: Handle = m.cue({
    patch: cast,
    subjects: CELLS,
    loop: true,
    name: 'cast',
  });
  const fixed: Handle = m.cue({
    patch: fix,
    subjects: CELLS,
    loop: true,
    name: 'correction',
  });
  const weigh = () => {
    lit.weight = Number(castWeight.input.value);
    fixed.weight = Number(fixWeight.input.value);
  };
  castWeight.input.addEventListener('input', weigh);
  fixWeight.input.addEventListener('input', weigh);
  weigh();
  const showRate = () => {
    play.textContent = show.rate === 0 ? 'Play' : 'Pause';
  };
  play.addEventListener('click', () => {
    show.rate = show.rate === 0 ? 1 : 0;
    showRate();
  });
  showRate();

  // The gray card's middle, for the readouts.
  const card = CELLS.reduce((a, c) =>
    c.base === GRAY && Math.hypot(c.x - 0.18, c.y - 0.58) < Math.hypot(a.x - 0.18, a.y - 0.58)
      ? c
      : a,
  );
  const pose: Balance = {};
  let drawn = -1;
  const stop = loop(show, (now) => {
    show.sync(now);
    if (show.seq === drawn) return;
    drawn = show.seq;
    CELLS.forEach((c, i) => {
      m.probe(c, pose);
      const under = toHex(pose.cast ?? NONE, c.base);
      put(lightOnly.image, i, under);
      put(corrected.image, i, toHex(pose.fix ?? NONE, under));
    });
    lightOnly.ctx.putImageData(lightOnly.image, 0, 0);
    corrected.ctx.putImageData(corrected.image, 0, 0);
    m.probe(card, pose);
    const under = toHex(pose.cast ?? NONE, card.base);
    lightOnly.read.textContent = reading(under);
    corrected.read.textContent = reading(toHex(pose.fix ?? NONE, under));
  });

  return () => {
    stop();
    m.close();
  };
}
