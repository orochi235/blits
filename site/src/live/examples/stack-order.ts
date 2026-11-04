import {
  add,
  color,
  colorBurn,
  colorDodge,
  colorMode,
  darken,
  difference,
  exclusion,
  type GpuDevice,
  gpu,
  gpuOf,
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
  pinLight,
  screen,
  shaderPatch,
  softLight,
  toHex,
  transport,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { type Grid, gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';
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

interface Disc extends Record<string, number> {
  angle: number;
  lab_l: number;
  lab_a: number;
  lab_b: number;
}
/** A disc turning about the middle, a third of a turn from the others, with some color in it. */
const DISC = shaderPatch<Cell, Tint, Disc>(PERIOD, {
  fields: { x: 'f32', y: 'f32' },
  params: { angle: 'f32', lab_l: 'f32', lab_a: 'f32', lab_b: 'f32' },
  wgsl: `let a = params.angle + 6.28318530718 * phase;
let cx = 0.5 + (0.16 * cos(a)) / ${ASPECT.toFixed(1)};
let cy = 0.5 + 0.16 * sin(a);
let d = 0.33 - length(vec2f((subject.x - cx) * ${ASPECT.toFixed(1)}, subject.y - cy));
let cov = clamp(0.5 + (d * ${ROWS.toFixed(1)}) / 2.0, 0.0, 1.0);
out.c = array<f32, 4>(params.lab_l * cov, params.lab_a * cov, params.lab_b * cov, cov);`,
  at: (phase, c, _, p) => {
    const a = p.angle + 2 * Math.PI * phase;
    const cx = 0.5 + (0.16 * Math.cos(a)) / ASPECT;
    const cy = 0.5 + 0.16 * Math.sin(a);
    const cov = edge(0.33 - Math.hypot((c.x - cx) * ASPECT, c.y - cy));
    // A zero coverage still names the mode, as the WGSL's always does.
    return { c: [p.lab_l * cov, p.lab_a * cov, p.lab_b * cov, cov] };
  },
  writes: ['c'],
});
const DISCS = Object.fromEntries(
  VOICES.map((v) => {
    const [l = 0, a = 0, b = 0] = oklab(v.rgb);
    return [v.name, DISC.with({ angle: v.angle, lab_l: l, lab_a: a, lab_b: b })];
  }),
) as Record<Name, typeof DISC>;

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
  return { fig, el, image: new ImageData(COLS, ROWS) };
}
type View = ReturnType<typeof view>;
const ctxOf = (v: View) => v.el.getContext('2d') as CanvasRenderingContext2D;

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

  // The picks live out here, so one made before the device is ready still counts.
  let refresh = () => drawOrder();
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
          refresh();
        });
        orderRow.append(swap);
      }
    });
    orderRow.append(play);
  };

  for (const { n, b } of modeButtons)
    b.addEventListener('click', () => {
      mode = n;
      refresh();
    });
  drawOrder();

  let stop = () => {};
  let gone = false;
  void gpuDevice().then((device) => {
    if (!gone) stop = start(device);
  });

  function start(device: GpuDevice | null): () => void {
    const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
    let left: Mix<Cell, Tint> | undefined;
    let right: Mix<Cell, Tint> | undefined;
    let grids: Grid[] = [];
    const pose: Tint = {};

    // The transport's time is NaN until its first sync.
    const into = () => (Number.isFinite(show.now) ? show.now % PERIOD : 0);
    // Each change makes both mixes again, the voices cued in order, each as far into its turn as
    // the transport is, so the discs carry on where they were.
    const build = (names: readonly Name[], name: string) => {
      const m = mix<Cell, Tint>(kit<Tint>({ c: color(RULES[mode]()) }), {
        name,
        transport: show,
        ...(device === null ? {} : { engine: gpu({ device }) }),
      });
      for (const n of names)
        m.cue({ patch: DISCS[n], subjects: CELLS, loop: true, name: n, seek: into() });
      if (device !== null) gpuOf(m).subjects(CELLS, (c) => ({ x: c.x, y: c.y }));
      return m;
    };
    // With the GPU, it folds both mixes and lays each over the ramp.
    const gridFor = (m: Mix<Cell, Tint>, v: View, gpuDev: GpuDevice) =>
      gpuGrid({
        canvas: v.el,
        cols: COLS,
        rows: ROWS,
        device: gpuDev,
        side: gpuOf(m),
        channels: [{ name: 'c', axes: mode in COMMUTING ? 4 : 18 }],
        bases: CELLS.map((c) => c.base),
        body:
          mode in COMMUTING ? 'shown = blits_over_free(c4_c(i), under);' : layStack('c', 'shown'),
        cpu: probed(m, CELLS),
      });
    const ctxs = device === null ? [ctxOf(fixed), ctxOf(yours)] : [];
    const diffCtx = device === null ? ctxOf(diff) : null;
    // On the GPU, the third view lays both mixes over the ramp and marks where they differ, as
    // `differing` does on the CPU.
    const lay = (name: string, v: string) =>
      mode in COMMUTING
        ? `${v} = blits_over_free(c4_${name}(i), under);`
        : `${v} = under; ${layStack(name, v)}`;
    const diffFor = (gpuDev: GpuDevice) =>
      gpuGrid({
        canvas: diff.el,
        cols: COLS,
        rows: ROWS,
        device: gpuDev,
        side: gpuOf(left as Mix<Cell, Tint>),
        channels: [
          { name: 'c', as: 'l', axes: mode in COMMUTING ? 4 : 18 },
          {
            name: 'c',
            as: 'r',
            axes: mode in COMMUTING ? 4 : 18,
            side: gpuOf(right as Mix<Cell, Tint>),
            cpu: probed(right as Mix<Cell, Tint>, CELLS),
          },
        ],
        bases: CELLS.map((c) => c.base),
        body: `var a = under; var b = under; ${lay('l', 'a')} ${lay('r', 'b')}
  let ea = round(blits_encode(a) * 255.0);
  let eb = round(blits_encode(b) * 255.0);
  if (any(abs(ea - eb) > vec3f(2.0))) { shown = blits_decode(vec3f(236.0, 64.0, 122.0) / 255.0); }
  else { shown = blits_decode(vec3f(floor((ea.x + ea.y + ea.z) / 6.0)) / 255.0); }`,
        cpu: probed(left as Mix<Cell, Tint>, CELLS),
      });

    let drawn = '';
    let counted = Number.NaN;
    const rebuild = () => {
      left?.close();
      right?.close();
      for (const g of grids) g.destroy();
      left = build(['A', 'B', 'C'], 'stack-order-cued');
      right = build(order, 'stack-order-yours');
      grids =
        device === null
          ? []
          : [gridFor(left, fixed, device), gridFor(right, yours, device), diffFor(device)];
      yoursCaption.textContent = `cued ${order.join(', ')}`;
      for (const { n, b } of modeButtons) b.ariaPressed = String(n === mode);
      drawOrder();
      drawn = '';
      counted = Number.NaN;
    };
    refresh = rebuild;

    play.addEventListener('click', () => {
      show.rate = show.rate === 0 ? 1 : 0;
      play.textContent = show.rate === 0 ? 'Play' : 'Pause';
    });

    const probe = (m: Mix<Cell, Tint> | undefined, v: View) => {
      CELLS.forEach((c, i) => {
        m?.probe(c, pose);
        const hex = toHex(pose.c ?? NONE, c.base);
        v.image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
      });
    };

    rebuild();
    const halt = loop(show, root, (now) => {
      show.sync(now);
      const key = `${show.seq}`;
      if (key === drawn) return;
      drawn = key;
      // The share is counted from probes, so on the GPU it is counted four times a second of mix
      // time rather than every frame.
      const count = device === null || !(Math.floor(show.now / 250) === counted);
      if (count) {
        counted = Math.floor(show.now / 250);
        probe(left, fixed);
        probe(right, yours);
      }
      if (device === null) {
        ctxs[0]?.putImageData(fixed.image, 0, 0);
        ctxs[1]?.putImageData(yours.image, 0, 0);
      } else for (const g of grids) g.draw();
      if (count) {
        const share = differing(fixed.image, yours.image, diff.image);
        if (device === null) diffCtx?.putImageData(diff.image, 0, 0);
        readout.textContent = `${(100 * share).toFixed(1).padStart(5)}% of pixels differ between the two`;
      }
    });

    return () => {
      halt();
      refresh = () => {};
      for (const g of grids) g.destroy();
      left?.close();
      right?.close();
    };
  }

  return () => {
    gone = true;
    stop();
  };
}
