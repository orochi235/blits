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
  type GpuDevice,
  gpu,
  gpuOf,
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
  pinLight,
  saturation,
  screen,
  shaderPatch,
  softLight,
  subtract,
  toHex,
  transport,
  vividLight,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { type Grid, gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';
import { loop } from '../loop';
import { scrubbed } from '../play';

interface Cell {
  x: number;
  y: number;
  /** The rows in its grid, so an edge is a pixel wide at any size. */
  rows: number;
  /** The color under it, as 0xrrggbb. */
  base: number;
}

const MODES = {
  plain: color(),
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
/** The modes that lay one layer, `[x, y, z, tag]`, rather than a stack. */
const FREE = new Set<Mode>(['multiply', 'screen', 'add', 'lighten', 'darken']);
/** A mode's name as the page shows it; channel names have to be WGSL identifiers. */
const title = (name: Mode) => (name === 'plain' ? 'no mode' : name);
const label = (name: Mode) => (ORDERED.has(name) ? `${name} · ordered` : title(name));

const ORANGE = oklab(0xf08a24);
const BLUE = oklab(0x2f8fd8);
const ASPECT = 48 / 21;
/** One sweep of the disc, out and back, in ms. */
const PERIOD = 5000;

/** Coverage for a cell `d` inside an edge, in tile heights: full a pixel in, none a pixel out. */
const edge = (d: number, rows: number) => Math.max(0, Math.min(1, 0.5 + (d * rows) / 2));
const EDGE_WGSL = `fn edge(d: f32, rows: f32) -> f32 { return clamp(0.5 + d * rows / 2.0, 0.0, 1.0); }`;

// A cell a shape misses still writes, at a coverage of 0, which lays nothing: a shader cannot skip a
// write, and a free mode's tag differs between a write of nothing and no write at all.
function tint(rgb: number[], cov: number, modes: readonly Mode[]): Tint {
  const out: Tint = {};
  const [L = 0, a = 0, b = 0] = rgb;
  const v = [L * cov, a * cov, b * cov, cov];
  for (const n of modes) out[n] = v;
  return out;
}
function tintWgsl(rgb: number[], cov: string, modes: readonly Mode[]): string {
  const [L = 0, a = 0, b = 0] = rgb;
  return `let cov = ${cov};
let v = array<f32, 4>(${L} * cov, ${a} * cov, ${b} * cov, cov);
${modes.map((n) => `out.${n} = v;`).join('\n')}`;
}

/** The three layers, written to `modes`: a band under the disc, the disc, and a band over it. */
function layers(m: Mix<Cell, Tint>, cells: Cell[], modes: readonly Mode[]): Handle {
  const band = shaderPatch<Cell, Tint, { y: number }>(0, {
    helpers: EDGE_WGSL,
    fields: { y: 'f32', rows: 'f32' },
    params: { y: 'f32' },
    wgsl: tintWgsl(ORANGE, 'edge(0.13 - abs(subject.y - params.y), subject.rows)', modes),
    at: (_, c, __, p) => tint(ORANGE, edge(0.13 - Math.abs(c.y - p.y), c.rows), modes),
    writes: modes,
  });
  // A disc of blue sweeping out and back across the ramp, eased at each end.
  const disc = shaderPatch<Cell, Tint>(PERIOD, {
    helpers: EDGE_WGSL,
    fields: { x: 'f32', y: 'f32', rows: 'f32' },
    wgsl: `let x = 0.12 + 0.76 * ((1.0 - cos(6.28318530718 * phase)) / 2.0);
${tintWgsl(BLUE, `edge(0.3 - length(vec2f((subject.x - x) * ${ASPECT}, subject.y - 0.5)), subject.rows)`, modes)}`,
    at: (phase, c) => {
      const x = 0.12 + 0.76 * ((1 - Math.cos(2 * Math.PI * phase)) / 2);
      return tint(BLUE, edge(0.3 - Math.hypot((c.x - x) * ASPECT, c.y - 0.5), c.rows), modes);
    },
    writes: modes,
  });
  // Voices lay on in the order they were cued: one band under the disc, the other over it.
  m.cue({ patch: band.with({ y: 0.75 }), subjects: cells });
  const sweep = m.cue({ patch: disc, subjects: cells, loop: true });
  m.cue({ patch: band.with({ y: 0.25 }), subjects: cells });
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

/** A mode's channel as a grid reads it, and the WGSL laying it over `under` as `toHex` does. */
function drawn(name: Mode): { axes: number; body: string } {
  if (name === 'plain') return { axes: 4, body: 'shown = blits_over_color(c4_plain(i), under);' };
  if (FREE.has(name)) return { axes: 4, body: `shown = blits_over_free(c4_${name}(i), under);` };
  return { axes: (MODES[name].rest as number[]).length, body: layStack(name, 'shown') };
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
    const el = canvas(48, 21);
    const text = document.createElement('span');
    text.textContent = title(name);
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
  wrap.append(big, caption, strip, controls);
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
    const fieldsOf = (c: Cell) => ({ x: c.x, y: c.y, rows: c.rows });

    // The thumbnails' mix holds every mode. The large view's holds only the one it shows, and is
    // made again for each pick, since a probe pays for every channel in its kit. Both run on one
    // transport, whose history keeps two sweeps so the debug panel can seek back through them.
    const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
    const m = mix<Cell, Tint>(kit<Tint>(MODES), {
      name: 'blend-modes',
      transport: show,
      ...engine,
    });
    const sweep = layers(m, small, NAMES);
    let chosen: Mode = 'overlay';
    let one: Mix<Cell, Tint> | undefined;
    let oneSweep: Handle | undefined;

    // Pausing stops the transport; dragging moves each disc's own voice to that point in its sweep.
    const place = scrubbed(show, play, scrub, PERIOD, () => [sweep, oneSweep]);

    let draw: () => void;
    let free = () => {};
    let picked: (mx: Mix<Cell, Tint>) => void;
    if (device !== null) {
      // The GPU folds every mode for every cell, and each view lays its mode over the ramp.
      gpuOf(m).subjects(small, fieldsOf);
      const view = (el: HTMLCanvasElement, mx: Mix<Cell, Tint>, cells: Cell[], name: Mode) => {
        const { axes, body } = drawn(name);
        return gpuGrid({
          canvas: el,
          cols: el.width,
          rows: el.height,
          device,
          side: gpuOf(mx),
          channels: [{ name, axes }],
          bases: cells.map((c) => c.base),
          body,
          cpu: probed(mx, cells),
        });
      };
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
      let onePose: Tint = {};
      picked = (mx) => {
        onePose = mx.pose();
      };
      draw = () => {
        small.forEach((c, i) => {
          m.probe(c, pose);
          for (const t of tiles) put(t.image, i, toHex(pose[t.name] as number[], c.base));
        });
        for (const t of tiles) t.ctx.putImageData(t.image, 0, 0);
        large.forEach((c, i) => {
          one?.probe(c, onePose);
          put(large1.image, i, toHex(onePose[chosen] as number[], c.base));
        });
        large1.ctx.putImageData(large1.image, 0, 0);
      };
    }

    const choose = (name: Mode) => {
      chosen = name;
      caption.textContent = label(name);
      for (const t of thumbs) t.button.ariaPressed = String(t.name === name);
      one?.close();
      one = mix<Cell, Tint>(kit<Tint>({ [name]: MODES[name] }), {
        name: 'blend-modes-large',
        transport: show,
        ...engine,
      });
      oneSweep = layers(one, large, [name]);
      oneSweep.seek(place());
      picked(one);
      seen = '';
    };
    for (const t of thumbs) t.button.addEventListener('click', () => choose(t.name));

    let seen = '';
    choose(chosen);
    const stop = loop(
      show,
      root,
      (now) => {
        show.sync(now);
        scrub.value = String(place());
        const key = `${show.seq} ${chosen}`;
        if (key === seen) return;
        seen = key;
        draw();
      },
      { settle: () => (one ? [m, one] : [m]) },
    );

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
