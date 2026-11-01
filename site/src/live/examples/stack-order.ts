import {
  add,
  color,
  colorBurn,
  colorDodge,
  colorMode,
  darken,
  difference,
  exclusion,
  hardLight,
  hue,
  kit,
  lighten,
  lighterColor,
  luminosity,
  type Mix,
  mix,
  multiply,
  oklab,
  overlay,
  patch,
  pinLight,
  screen,
  softLight,
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
interface Tint {
  c?: number[];
}

/** Modes whose layers fold into one, so any order gives the same color. */
const COMMUTING = { multiply, screen, add, lighten, darken };
/** Modes that lay each layer on what is under it, in voice order. */
const ORDERED = {
  overlay,
  softLight,
  hardLight,
  colorDodge,
  colorBurn,
  difference,
  exclusion,
  pinLight,
  hue,
  colorMode,
  luminosity,
  lighterColor,
};
type Mode = keyof typeof COMMUTING | keyof typeof ORDERED;
const RULES: Record<Mode, () => ReturnType<typeof overlay>> = { ...COMMUTING, ...ORDERED };

const VOICES = [
  { name: 'A', rgb: 0xf08a24, angle: -Math.PI / 2 },
  { name: 'B', rgb: 0x2fb8a0, angle: Math.PI / 6 },
  { name: 'C', rgb: 0x8a5cf0, angle: (5 * Math.PI) / 6 },
] as const;
type Name = (typeof VOICES)[number]['name'];

/** A color that lays nothing on what is under it. */
const NONE = [0, 0, 0, 0];
const COLS = 120;
const ROWS = 60;
const ASPECT = COLS / ROWS;
/** One turn of the three discs about the middle, in ms. */
const PERIOD = 9000;

/** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
const edge = (d: number) => Math.max(0, Math.min(1, 0.5 + (d * ROWS) / 2));

/** A disc turning about the middle, a third of a turn from the others, with some color in it. */
function disc(v: (typeof VOICES)[number]) {
  const lab = oklab(v.rgb);
  return patch<Cell, Tint>(
    PERIOD,
    (phase, c) => {
      const a = v.angle + 2 * Math.PI * phase;
      const cx = 0.5 + (0.16 * Math.cos(a)) / ASPECT;
      const cy = 0.5 + 0.16 * Math.sin(a);
      const cov = edge(0.33 - Math.hypot((c.x - cx) * ASPECT, c.y - cy));
      if (cov === 0) return {};
      return { c: [(lab[0] ?? 0) * cov, (lab[1] ?? 0) * cov, (lab[2] ?? 0) * cov, cov] };
    },
    { writes: ['c'] },
  );
}
const DISCS = Object.fromEntries(VOICES.map((v) => [v.name, disc(v)])) as Record<
  Name,
  ReturnType<typeof disc>
>;

/** Dark gray on the left to near white on the right, through muted color, since hue keeps a gray gray. */
function ramp(x: number): number {
  const C = 0.09 * Math.sin(Math.PI * x);
  const h = 2.2 + 2.4 * x;
  return toHex([0.35 + 0.55 * x, C * Math.cos(h), C * Math.sin(h), 1], 0) as number;
}

const CELLS: Cell[] = [];
for (let y = 0; y < ROWS; y++)
  for (let x = 0; x < COLS; x++)
    CELLS.push({ x: x / (COLS - 1), y: y / (ROWS - 1), base: ramp(x / (COLS - 1)) });

function view(caption: HTMLElement) {
  const fig = document.createElement('figure');
  const el = document.createElement('canvas');
  el.width = COLS;
  el.height = ROWS;
  fig.append(el, caption);
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  return { fig, ctx, image: ctx.createImageData(COLS, ROWS) };
}

function button(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  return b;
}

/**
 * Marks in `out` each pixel whose color differs between `a` and `b` by more than rounding, and
 * gives the share that do.
 */
function differing(a: ImageData, b: ImageData, out: ImageData): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let differs = false;
    for (let k = 0; k < 3; k++)
      if (Math.abs((a.data[i + k] as number) - (b.data[i + k] as number)) > 2) differs = true;
    if (differs) n++;
    const gray =
      ((a.data[i] as number) + (a.data[i + 1] as number) + (a.data[i + 2] as number)) / 6;
    out.data.set(differs ? [236, 64, 122, 255] : [gray, gray, gray, 255], i);
  }
  return n / (a.data.length / 4);
}

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';

  const modeRows = (label: string, names: Mode[]) => {
    const row = document.createElement('div');
    row.className = 'rig-row';
    const tag = document.createElement('span');
    tag.className = 'rig-label';
    tag.textContent = label;
    row.append(tag);
    return { row, buttons: names.map((n) => ({ n, b: row.appendChild(button(n)) })) };
  };
  const any = modeRows('Any order', Object.keys(COMMUTING) as Mode[]);
  const ord = modeRows('Ordered', Object.keys(ORDERED) as Mode[]);
  const modeButtons = [...any.buttons, ...ord.buttons];

  const fixedCaption = document.createElement('figcaption');
  fixedCaption.textContent = 'cued A, B, C';
  const yoursCaption = document.createElement('figcaption');
  const fixed = view(fixedCaption);
  const yours = view(yoursCaption);
  const diffCaption = document.createElement('figcaption');
  diffCaption.textContent = 'where they differ';
  const diff = view(diffCaption);
  const pair = document.createElement('div');
  pair.className = 'rig-pair';
  pair.append(fixed.fig, yours.fig, diff.fig);

  // The order of the right-hand mix's cues, with a swap between each pair of neighbors.
  const orderRow = document.createElement('div');
  orderRow.className = 'rig-row';
  const play = button('Pause');
  const readout = document.createElement('p');
  readout.className = 'rig-read';
  wrap.append(any.row, ord.row, pair, orderRow, readout);
  root.append(wrap);

  let mode: Mode = 'overlay';
  let order: Name[] = ['C', 'A', 'B'];

  const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
  let left: Mix<Cell, Tint> | undefined;
  let right: Mix<Cell, Tint> | undefined;
  const pose: Tint = {};

  // The transport's time is NaN until its first sync.
  const into = () => (Number.isFinite(show.now) ? show.now % PERIOD : 0);
  // Each change makes both mixes again, the voices cued in order, each as far into its turn as
  // the transport is, so the discs carry on where they were.
  const build = (names: readonly Name[], name: string) => {
    const m = mix<Cell, Tint>(kit<Tint>({ c: color(RULES[mode]()) }), { name, transport: show });
    for (const n of names)
      m.cue({ patch: DISCS[n], subjects: CELLS, loop: true, name: n, seek: into() });
    return m;
  };
  let drawn = '';
  const rebuild = () => {
    left?.close();
    right?.close();
    left = build(['A', 'B', 'C'], 'stack-order-cued');
    right = build(order, 'stack-order-yours');
    yoursCaption.textContent = `cued ${order.join(', ')}`;
    for (const { n, b } of modeButtons) b.ariaPressed = String(n === mode);
    drawOrder();
    drawn = '';
  };

  const drawOrder = () => {
    orderRow.replaceChildren();
    const tag = document.createElement('span');
    tag.className = 'rig-label';
    tag.textContent = 'Right-hand order';
    orderRow.append(tag);
    order.forEach((n, i) => {
      const chip = document.createElement('span');
      chip.className = `rig-chip rig-chip-${n.toLowerCase()}`;
      chip.textContent = n;
      orderRow.append(chip);
      if (i < order.length - 1) {
        const swap = button('⇄');
        swap.ariaLabel = `Swap ${n} and ${order[i + 1]}`;
        swap.addEventListener('click', () => {
          const next = [...order];
          [next[i], next[i + 1]] = [next[i + 1] as Name, next[i] as Name];
          order = next;
          rebuild();
        });
        orderRow.append(swap);
      }
    });
    orderRow.append(play);
  };

  for (const { n, b } of modeButtons)
    b.addEventListener('click', () => {
      mode = n;
      rebuild();
    });
  play.addEventListener('click', () => {
    show.rate = show.rate === 0 ? 1 : 0;
    play.textContent = show.rate === 0 ? 'Play' : 'Pause';
  });

  const paint = (m: Mix<Cell, Tint> | undefined, v: ReturnType<typeof view>) => {
    CELLS.forEach((c, i) => {
      m?.probe(c, pose);
      const hex = toHex(pose.c ?? NONE, c.base);
      v.image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
    });
    v.ctx.putImageData(v.image, 0, 0);
  };

  rebuild();
  const stop = loop(show, (now) => {
    show.sync(now);
    const key = `${show.seq}`;
    if (key === drawn) return;
    drawn = key;
    paint(left, fixed);
    paint(right, yours);
    const share = differing(fixed.image, yours.image, diff.image);
    diff.ctx.putImageData(diff.image, 0, 0);
    readout.textContent = `${(100 * share).toFixed(1).padStart(5)}% of pixels differ between the two`;
  });

  return () => {
    stop();
    left?.close();
    right?.close();
  };
}
