import {
  color,
  colorDodge,
  difference,
  kit,
  luminosity,
  type Mix,
  mix,
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
  /** How much of the cell its creature covers, for a flash's edge. */
  cov: number;
}
interface Flash {
  hit?: number[];
}

const MODES = { difference, colorDodge, luminosity };
type Mode = keyof typeof MODES;

const COLS = 160;
const ROWS = 80;
const ASPECT = COLS / ROWS;
const NONE = [0, 0, 0, 0];
/** How long a flash lasts, in ms. */
const FLASH = 380;
/** How much of a flash holds at full before it fades. */
const HOLD = 0.4;
/** How long between hits the scene lands by itself, in ms. */
const EVERY = 1300;

const CREATURES = [
  { x: 0.22, y: 0.56, r: 0.26, rgb: 0x3fae5a },
  { x: 0.5, y: 0.5, r: 0.32, rgb: 0xe0a030 },
  { x: 0.78, y: 0.58, r: 0.24, rgb: 0x5a7ae0 },
];

const edge = (d: number) => Math.max(0, Math.min(1, 0.5 + (d * ROWS) / 2));

/** The scene under a cell, and which creature covers it, if any, and how much. */
function scene(x: number, y: number): { base: number; who: number; cov: number } {
  for (const [who, c] of CREATURES.entries()) {
    const dx = (x - c.x) * ASPECT;
    const dy = y - c.y;
    const cov = edge(c.r - Math.hypot(dx, dy * 1.15));
    if (cov === 0) continue;
    const eye = [-0.09, 0.09].some((ex) => Math.hypot(dx - ex, dy + c.r * 0.35) < 0.045);
    const [L = 0, A = 0, B = 0] = oklab(c.rgb);
    const body = toHex([L - 0.12 * dy, A, B, 1], 0) as number;
    return { base: eye ? 0x16161c : body, who, cov };
  }
  return { base: toHex([0.24 + 0.1 * y, -0.005, -0.03, 1], 0) as number, who: -1, cov: 0 };
}

/** A flash of white over each cell of a creature, held full for its first 40%, then fading out. */
const flash = patch<Cell, Flash>(
  FLASH,
  (phase, c) => {
    const fade = phase < HOLD ? 1 : (1 - phase) / (1 - HOLD);
    const a = c.cov * fade * fade;
    return a > 0 ? { hit: [a, 0, 0, a] } : {};
  },
  { writes: ['hit'] },
);

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const el = document.createElement('canvas');
  el.width = COLS;
  el.height = ROWS;
  el.className = 'rig-target';
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(COLS, ROWS);
  const row = document.createElement('div');
  row.className = 'rig-row';
  const button = (text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    row.append(b);
    return b;
  };
  const modeButtons = (Object.keys(MODES) as Mode[]).map((n) => ({ n, b: button(n) }));
  const double = button('Double hit');
  const auto = button('Auto');
  wrap.append(el, row);
  root.append(wrap);

  const cells: Cell[] = [];
  const bodies: Cell[][] = CREATURES.map(() => []);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const s = scene(x / (COLS - 1), y / (ROWS - 1));
      const c = { x: x / (COLS - 1), y: y / (ROWS - 1), base: s.base, cov: s.cov };
      cells.push(c);
      if (s.who >= 0) bodies[s.who]?.push(c);
    }

  const show = transport({ history: { ms: 4 * EVERY, tape: createHistory } });
  let m: Mix<Cell, Flash> | undefined;
  const choose = (mode: Mode) => {
    m?.close();
    // Room for eight flashes laid on one cell at once.
    m = mix<Cell, Flash>(kit<Flash>({ hit: color(MODES[mode]({ layers: 8 })) }), {
      name: 'hit-flash',
      transport: show,
    });
    for (const { n, b } of modeButtons) b.ariaPressed = String(n === mode);
    drawn = -1;
  };
  // Each hit is one voice over the creature's cells for one pass, leaving when the pass ends.
  const hit = (who: number, after = 0) => {
    const subjects = bodies[who];
    if (m === undefined || subjects === undefined) return;
    m.cue({ patch: flash, subjects, start: m.now + after });
  };
  for (const { n, b } of modeButtons) b.addEventListener('click', () => choose(n));
  double.addEventListener('click', () => {
    hit(1);
    hit(1, 70);
  });
  let autoOn = true;
  auto.ariaPressed = 'true';
  auto.addEventListener('click', () => {
    autoOn = !autoOn;
    auto.ariaPressed = String(autoOn);
  });
  const onClick = (e: MouseEvent) => {
    const box = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - box.left) / box.width) * COLS);
    const y = Math.floor(((e.clientY - box.top) / box.height) * ROWS);
    const s = scene(x / (COLS - 1), y / (ROWS - 1));
    if (s.who >= 0) hit(s.who);
  };
  el.addEventListener('click', onClick);

  let drawn = -1;
  let last = 0;
  choose('difference');
  const pose: Flash = {};
  const stop = loop(show, (now) => {
    show.sync(now);
    if (autoOn && show.now - last >= EVERY) {
      last = show.now;
      hit(Math.floor(Math.random() * CREATURES.length));
    }
    if (show.seq === drawn) return;
    drawn = show.seq;
    cells.forEach((c, i) => {
      m?.probe(c, pose);
      const hex = toHex(pose.hit ?? NONE, c.base);
      image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
    });
    ctx.putImageData(image, 0, 0);
  });

  return () => {
    stop();
    el.removeEventListener('click', onClick);
    m?.close();
  };
}
