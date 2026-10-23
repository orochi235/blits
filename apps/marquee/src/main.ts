import './app.css';
import { level, mix } from '@msb235/blits';
import { mount } from '@msb235/blits-panel';
import { board, KIT, type Led, type Pose, SIZE, type Subject } from './board';
import { createSign } from './draw';
import { LAYERS, TEXT, type TextName } from './effects';
import { cueLayer, play, type Step } from './show';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const canvas = el<HTMLCanvasElement>('sign');
const message = el<HTMLInputElement>('message');
const hue = el<HTMLSelectElement>('hue');
const rate = el<HTMLInputElement>('rate');
const rateOut = el<HTMLOutputElement>('rate-out');
const cost = el<HTMLOutputElement>('cost');
const colsIn = el<HTMLInputElement>('cols');
const rowsIn = el<HTMLInputElement>('rows');
const sizeForm = el<HTMLFormElement>('size');

/** A gap between frames this long is a hidden tab coming back, and is left out of the show. */
const AWAY_MS = 250;
const AMBER = 0xff9a2e;
const RED = 0xff4030;
const GREEN = 0x6dff5a;

const params = new URLSearchParams(location.search);
if (import.meta.env.DEV && !params.has('nopanel')) mount();

/** `?cols=&rows=` size the sign, for stretching it to benchmark; `?nodraw` times the mix alone. */
const whole = (key: string, fallback: number, most: number) => {
  const v = Math.floor(Number(params.get(key)));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, most) : fallback;
};
const b = board(whole('cols', SIZE.cols, 4000), whole('rows', SIZE.rows, 2000));
const drawing = !params.has('nodraw');
colsIn.value = String(b.cols);
rowsIn.value = String(b.rows);
sizeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  params.set('cols', colsIn.value);
  params.set('rows', rowsIn.value);
  location.search = params.toString();
});

const m = mix<Subject, Pose>(KIT, {
  name: 'marquee',
  labelOf: (s: Subject) => (s.kind === 'cell' ? `cell ${s.i}` : `dot ${s.x},${s.y}`),
});

const leds: readonly Led[] = [...b.dots, ...b.bulbs];
const lit = new Float64Array(leds.length);
const tint = new Float64Array(leds.length * 4);
const cellLit = new Float64Array(b.cells.length);
const cellTint = new Float64Array(b.cells.length * 4);
const bulbsAt = b.dots.length;
/** Paints each bulb with its cell's pose, after the dots in the columns the sign reads. */
const paintBulbs = () => {
  for (let j = 0; j < b.bulbs.length; j++) {
    const c = b.cellOf[j] as number;
    lit[bulbsAt + j] = cellLit[c] as number;
    tint.set(cellTint.subarray(c * 4, c * 4 + 4), (bulbsAt + j) * 4);
  }
};
const sign = createSign(canvas, b, leds);

const userHex = () => Number.parseInt(hue.value, 16);
/** `?show=flip` loops that one effect on the message, for looking at it alone. */
const only = params.get('show');
const program = (): Step[] =>
  only !== null && only in TEXT
    ? [{ how: only as TextName, text: message.value || ' ', hex: userHex() }]
    : [
        { how: 'hold', text: 'BLITS', hex: AMBER },
        { how: 'scroll', text: message.value || ' ', hex: userHex() },
        { how: 'flip', text: 'NOW SHOWING', hex: RED },
        { how: 'tile', text: message.value || ' ', hex: userHex() },
        { how: 'roll', text: 'JACKPOT', hex: GREEN },
        {
          how: 'scroll',
          text: 'CONCURRENT EFFECTS, FOLDED INTO ONE VALUE PER DOT PER FRAME',
          hex: GREEN,
        },
        { how: 'fall', text: 'TONIGHT!', hex: AMBER },
      ];

// Each pass reads the message and color as they stand when it starts.
const again = () => {
  play(m, b, program()).done.then(again);
};
again();

// Each layer's checkbox shares its name, and sets its weight between 0 and the layer's own.
for (const l of Object.values(LAYERS)) {
  const box = el<HTMLInputElement>(l.name);
  const on = () => (box.checked ? (l.weight ?? 1) : 0);
  const weight = level<Subject>(on());
  cueLayer(m, b, l, weight);
  box.addEventListener('change', () => weight.set(on()));
}
rate.addEventListener('input', () => {
  m.ramp(Number(rate.value), 200);
  rateOut.value = `${Number(rate.value).toFixed(2)}×`;
});

let last = performance.now();
let mixMs = 0;
let drawMs = 0;
let shownAt = 0;
let frames = 0;
const frame = (now: number) => {
  requestAnimationFrame(frame);
  let gap = now - last;
  last = now;
  if (gap > AWAY_MS) {
    m.rebase();
    gap = 0;
  }
  const t0 = performance.now();
  m.sync(now);
  m.pull(b.dots, { lit, tint });
  m.pull(b.cells, { lit: cellLit, tint: cellTint });
  paintBulbs();
  const t1 = performance.now();
  if (drawing) sign.render(lit, tint, userHex(), gap);
  const t2 = performance.now();
  mixMs += (t1 - t0 - mixMs) * 0.05;
  drawMs += (t2 - t1 - drawMs) * 0.05;
  frames++;
  if (now - shownAt > 250) {
    const fps = (frames * 1000) / (now - shownAt);
    frames = 0;
    shownAt = now;
    cost.value = `${leds.length} lights, ${b.dots.length + b.cells.length} subjects · ${fps.toFixed(0).padStart(3)} fps · mix ${mixMs.toFixed(2).padStart(6)} ms · draw ${drawMs.toFixed(2).padStart(6)} ms`;
  }
};
requestAnimationFrame(frame);
