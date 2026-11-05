import {
  type GpuDevice,
  gpu,
  gpuOf,
  type Handle,
  type Kit,
  kit,
  last,
  type Mix,
  max,
  min,
  mix,
  mul,
  norm,
  screen,
  shaderPatch,
  sum,
  transport,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { type Grid, gpuDevice, gpuGrid, probed } from '../gpu-grid';
import { loop } from '../loop';
import { showPlay } from '../play';

interface Cell {
  x: number;
  y: number;
}

const RULES = {
  sum: sum(),
  mul: mul(),
  max: max(),
  min: min(),
  norm2: norm(),
  norm4: norm({ power: 4 }),
  screen: screen(),
  last: last<number>(),
};
type Rule = keyof typeof RULES;
type Values = Partial<Record<Rule, number>>;
const NAMES = Object.keys(RULES) as Rule[];
/** A rule's name as the page shows it; channel names have to be WGSL identifiers. */
const TITLE: Record<Rule, string> = {
  sum: 'sum',
  mul: 'mul',
  max: 'max',
  min: 'min',
  norm2: 'norm(2)',
  norm4: 'norm(4)',
  screen: 'screen',
  last: 'last',
};

const ASPECT = 48 / 21;
/** One sweep of the disc, out and back, in ms. */
const PERIOD = 5000;
/** The numbers the three voices write: the bottom band, the disc, and the top band. */
const UNDER = 0.5;
const DISC = 0.9;
const OVER = 0.7;

/** A number as a WGSL f32 literal. */
const lit = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/** The rules the gpu engine has no WGSL for, which stay on the CPU. */
const CPU_ONLY = new Set<Rule>(['last']);

// A shader patch writes every channel for every subject, so a cell a shape misses writes the
// rule's rest, which folds to nothing. `last` has no rest, so a miss leaves it unwritten.
function write(value: number, inside: boolean, rules: readonly Rule[]): Values {
  const out: Values = {};
  for (const n of rules) {
    const rest = RULES[n].rest;
    if (inside) out[n] = value;
    else if (typeof rest === 'number') out[n] = rest;
  }
  return out;
}
function writeWgsl(rules: readonly Rule[], inside: string, value: string): string {
  return rules
    .map((n) => {
      const rest = RULES[n].rest;
      return `out.${n} = select(${lit(typeof rest === 'number' ? rest : 0)}, ${value}, ${inside});`;
    })
    .join('\n');
}

/** The three layers, written to `rules`: a band under the disc, the disc, and a band over it. */
function voices(m: Mix<Cell, Values>, cells: Cell[], rules: readonly Rule[]): Handle {
  const band = shaderPatch<Cell, Values, { y: number; value: number }>(0, {
    fields: { y: 'f32' },
    params: { y: 'f32', value: 'f32' },
    wgsl: writeWgsl(rules, 'abs(subject.y - params.y) < 0.13', 'params.value'),
    at: (_, c, __, p) => write(p.value, Math.abs(c.y - p.y) < 0.13, rules),
    writes: rules,
  });
  // A disc sweeping out and back across the tile, eased at each end.
  const disc = shaderPatch<Cell, Values>(PERIOD, {
    fields: { x: 'f32', y: 'f32' },
    wgsl: `let x = 0.12 + 0.76 * ((1.0 - cos(6.28318530718 * phase)) / 2.0);
let inside = length(vec2f((subject.x - x) * ${ASPECT}, subject.y - 0.5)) < 0.3;
${writeWgsl(rules, 'inside', lit(DISC))}`,
    at: (phase, c) => {
      const x = 0.12 + 0.76 * ((1 - Math.cos(2 * Math.PI * phase)) / 2);
      return write(DISC, Math.hypot((c.x - x) * ASPECT, c.y - 0.5) < 0.3, rules);
    },
    writes: rules,
  });
  // Cued in this order, so `last` shows the top band over the disc over the bottom band.
  m.cue({ patch: band.with({ y: 0.7, value: UNDER }), subjects: cells });
  const sweep = m.cue({ patch: disc, subjects: cells, loop: true });
  m.cue({ patch: band.with({ y: 0.3, value: OVER }), subjects: cells });
  return sweep;
}

/**
 * The layers for `rules`, and each set's disc voice. A voice writing a rule the GPU cannot fold
 * stays on the CPU whole, so those rules get voices of their own and the rest still fold there.
 */
function layers(m: Mix<Cell, Values>, cells: Cell[], rules: readonly Rule[]): Handle[] {
  return [rules.filter((n) => !CPU_ONLY.has(n)), rules.filter((n) => CPU_ONLY.has(n))]
    .filter((set) => set.length > 0)
    .map((set) => voices(m, cells, set));
}

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
const rgbWgsl = (c: number) => `vec3f(${c >> 16}.0, ${(c >> 8) & 0xff}.0, ${c & 0xff}.0)`;
/**
 * `shade` in WGSL, for a grid's body: cell `i`'s value in channel `name` as `shown`. A value below
 * zero is one the CPU found no voice writing, which only `last` leaves.
 */
function shadeWgsl(name: Rule): string {
  return `{
    let v = c_${name}(i, 0u);
    if (v < 0.0) {
      shown = blits_decode(${rgbWgsl(NONE)} / 255.0);
    } else {
      var stops = array<vec3f, ${STOPS.length}>(${STOPS.map(rgbWgsl).join(', ')});
      let t = clamp(v, 0.0, 2.0) / 2.0 * ${lit(STOPS.length - 1)};
      let k = min(${STOPS.length - 2}u, u32(floor(t)));
      let u = t - f32(k);
      shown = blits_decode(round(mix(stops[k], stops[k + 1u], u)) / 255.0);
    }
  }`;
}

function grid(cols: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) cells.push({ x: x / (cols - 1), y: y / (rows - 1) });
  return cells;
}

function canvas(cols: number, rows: number): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = cols;
  el.height = rows;
  return el;
}

/** A canvas drawn on the CPU, and the image it puts. */
function painted(el: HTMLCanvasElement) {
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  return { ctx, image: ctx.createImageData(el.width, el.height) };
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
  const barEl = canvas(160, 1);
  const bar = painted(barEl);
  for (let i = 0; i < 160; i++) put(bar.image, i, shade((2 * i) / 159));
  bar.ctx.putImageData(bar.image, 0, 0);
  const ticks = document.createElement('div');
  for (const t of ['0', '1', '2']) {
    const tick = document.createElement('span');
    tick.textContent = t;
    ticks.append(tick);
  }
  scale.append(barEl, ticks);

  const strip = document.createElement('div');
  strip.className = 'picker-strip';
  const thumbs = NAMES.map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    const el = canvas(48, 21);
    const text = document.createElement('span');
    text.textContent = TITLE[name];
    button.append(el, text);
    strip.append(button);
    return { name, button, el };
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
  wrap.append(big, caption, scale, strip, controls);
  root.append(wrap);

  let stop = () => {};
  let gone = false;
  void gpuDevice().then((device) => {
    if (!gone) stop = start(device);
  });

  function start(device: GpuDevice | null): () => void {
    const small = grid(48, 21);
    const large = grid(192, 84);
    const engine = device === null ? {} : { engine: gpu({ device }) };
    const fieldsOf = (c: Cell) => ({ x: c.x, y: c.y });

    // The thumbnails' mix holds every rule. The large view's holds only the one it shows, and is
    // made again for each pick, since a probe pays for every channel in its kit. Both run on one
    // transport, whose history keeps two sweeps so the debug panel can seek back through them.
    const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
    const m = mix<Cell, Values>(kit<Values>(RULES), {
      name: 'number-rules',
      transport: show,
      ...engine,
    });
    const sweeps = layers(m, small, NAMES);
    let chosen: Rule = 'norm2';
    let one: Mix<Cell, Values> | undefined;
    let oneSweeps: Handle[] = [];

    // Pausing stops the transport; dragging moves each disc's own voice to that point in its
    // sweep. The slider shows the disc's place: the transport's time, shifted by the last drag.
    let shift = 0;
    // `now` is NaN until the first sync, and the first pick comes before it.
    const place = () =>
      Number.isNaN(show.now) ? 0 : (((show.now + shift) % PERIOD) + PERIOD) % PERIOD;

    let draw: () => void;
    let free = () => {};
    let picked: (mx: Mix<Cell, Values>) => void;
    if (device !== null) {
      gpuOf(m).subjects(small, fieldsOf);
      const view = (el: HTMLCanvasElement, mx: Mix<Cell, Values>, cells: Cell[], name: Rule) =>
        gpuGrid({
          canvas: el,
          cols: el.width,
          rows: el.height,
          device,
          side: gpuOf(mx),
          channels: [{ name, axes: 1 }],
          bases: new Array(cells.length).fill(0),
          body: shadeWgsl(name),
          cpu: probed(mx, cells, -1),
        });
      const tiles = thumbs.map((t) => view(t.el, m, small, t.name));
      let large1: Grid | undefined;
      picked = (mx) => {
        large1?.destroy();
        gpuOf(mx).subjects(large, fieldsOf);
        large1 = view(big, mx, large, chosen);
      };
      draw = () => {
        for (const g of tiles) g.draw();
        large1?.draw();
      };
      free = () => {
        for (const g of tiles) g.destroy();
        large1?.destroy();
      };
    } else {
      const pose = m.pose();
      const tiles = thumbs.map((t) => ({ name: t.name, ...painted(t.el) }));
      const large1 = painted(big);
      let onePose: Values = {};
      picked = (mx) => {
        onePose = mx.pose();
      };
      draw = () => {
        small.forEach((c, i) => {
          m.probe(c, pose);
          for (const t of tiles) put(t.image, i, shade(pose[t.name]));
        });
        for (const t of tiles) t.ctx.putImageData(t.image, 0, 0);
        large.forEach((c, i) => {
          one?.probe(c, onePose);
          put(large1.image, i, shade(onePose[chosen]));
        });
        large1.ctx.putImageData(large1.image, 0, 0);
      };
    }

    const choose = (name: Rule) => {
      chosen = name;
      caption.textContent = TITLE[name];
      for (const t of thumbs) t.button.ariaPressed = String(t.name === name);
      one?.close();
      one = mix<Cell, Values>(kit<Values>({ [name]: RULES[name] } as Kit<Values>), {
        name: 'number-rules-large',
        transport: show,
        ...engine,
      });
      oneSweeps = layers(one, large, [name]);
      for (const s of oneSweeps) s.seek(place());
      picked(one);
      drawn = '';
    };
    for (const t of thumbs) t.button.addEventListener('click', () => choose(t.name));

    const showRate = () => {
      showPlay(play, show.rate === 0);
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
      for (const s of [...sweeps, ...oneSweeps]) s.seek(to);
      shift = to - show.now;
    });

    let drawn = '';
    choose(chosen);
    showRate();
    const stop = loop(show, root, (now) => {
      show.sync(now);
      scrub.value = String(place());
      const key = `${show.seq} ${chosen}`;
      if (key === drawn) return;
      drawn = key;
      draw();
    });

    return () => {
      stop();
      free();
      one?.close();
      m.close();
    };
  }

  return () => {
    gone = true;
    stop();
  };
}
