import './app.css';
import { level, mix } from '@msb235/blits';
import { mount } from '@msb235/blits-panel';
import { board, chase, KIT, type Led, type Pose, SIZE, sparkle } from './board';
import { createSign } from './draw';
import { play, type Step } from './show';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const canvas = el<HTMLCanvasElement>('sign');
const message = el<HTMLInputElement>('message');
const hue = el<HTMLSelectElement>('hue');
const rate = el<HTMLInputElement>('rate');
const rateOut = el<HTMLOutputElement>('rate-out');
const sparkles = el<HTMLInputElement>('sparkle');
const chasing = el<HTMLInputElement>('chase');
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

const m = mix<Led, Pose>(KIT, {
  name: 'marquee',
  labelOf: (led: Led) => (led.kind === 'bulb' ? `bulb ${led.i}` : `dot ${led.x},${led.y}`),
});

const leds: readonly Led[] = [...b.dots, ...b.bulbs];
const lit = new Float64Array(leds.length);
const tint = new Float64Array(leds.length * 4);
const sign = createSign(canvas, b, leds);

const userHex = () => Number.parseInt(hue.value, 16);
const program = (): Step[] => [
  { how: 'hold', text: 'BLITS', hex: AMBER },
  { how: 'scroll', text: message.value || ' ', hex: userHex() },
  { how: 'hold', text: 'NOW SHOWING', hex: RED },
  {
    how: 'scroll',
    text: 'CONCURRENT EFFECTS, FOLDED INTO ONE VALUE PER DOT PER FRAME',
    hex: GREEN,
  },
  { how: 'hold', text: 'TONIGHT!', hex: AMBER },
];

// Each pass reads the message and color as they stand when it starts.
const again = () => {
  play(m, b, program()).done.then(again);
};
again();

const sparkleLevel = level<Led>(sparkles.checked ? 1 : 0);
const chaseLevel = level<Led>(chasing.checked ? 1 : 0);
m.cue({ name: 'sparkle', patch: sparkle, subjects: b.dots, loop: true, weight: sparkleLevel });
m.cue({ name: 'chase', patch: chase, subjects: b.bulbs, loop: true, weight: chaseLevel });

sparkles.addEventListener('change', () => sparkleLevel.set(sparkles.checked ? 1 : 0));
chasing.addEventListener('change', () => chaseLevel.set(chasing.checked ? 1 : 0));
rate.addEventListener('input', () => {
  m.ramp(Number(rate.value), 200);
  rateOut.value = `${Number(rate.value).toFixed(2)}×`;
});

let last = performance.now();
let mixMs = 0;
let drawMs = 0;
let shownAt = 0;
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
  m.pull(leds, { lit, tint });
  const t1 = performance.now();
  if (drawing) sign.render(lit, tint, userHex(), gap);
  const t2 = performance.now();
  mixMs += (t1 - t0 - mixMs) * 0.05;
  drawMs += (t2 - t1 - drawMs) * 0.05;
  if (now - shownAt > 250) {
    shownAt = now;
    cost.value = `${leds.length} lights · mix ${mixMs.toFixed(2).padStart(6)} ms · draw ${drawMs.toFixed(2).padStart(6)} ms`;
  }
};
requestAnimationFrame(frame);
