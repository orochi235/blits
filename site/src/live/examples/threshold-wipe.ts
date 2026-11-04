import {
  color,
  type GpuDevice,
  gpu,
  gpuOf,
  type Handle,
  hardMix,
  kit,
  linearLight,
  type Mix,
  mix,
  shaderPatch,
  toHex,
  transport,
  vividLight,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { type Grid, gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';
import { loop } from '../loop';

interface Cell {
  x: number;
  y: number;
  base: number;
}
interface Wipe {
  w?: number[];
}

const MODES = { hardMix, vividLight, linearLight };
type Mode = keyof typeof MODES;

const COLS = 160;
const ROWS = 80;
const ASPECT = COLS / ROWS;
/** One sweep of the level, up and back down, in ms. */
const PERIOD = 6000;
const NONE = [0, 0, 0, 0];

/** Smooth noise in [0, 1], a few octaves of interpolated lattice values. */
function clouds(x: number, y: number): number {
  const hash = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  let sum = 0;
  let amp = 0.5;
  let f = 3;
  for (let o = 0; o < 4; o++, amp /= 2, f *= 2) {
    const i = Math.floor(x * f);
    const j = Math.floor(y * f);
    const u = smooth(x * f - i);
    const v = smooth(y * f - j);
    const top = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u;
    const bottom = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
    sum += amp * (top + (bottom - top) * v);
  }
  return sum / 0.9375;
}

/** The maps the level sweeps through: where each is lightest goes first. */
const MAPS: Record<string, (x: number, y: number) => number> = {
  iris: (x, y) => 1 - Math.min(1, Math.hypot((x - 0.5) * ASPECT, y - 0.5) / 1.15),
  diagonal: (x, y) => (x * ASPECT + y) / (ASPECT + 1),
  clouds,
};

/** A map's value as a color, each channel a little apart so the edge passes through color. */
function base(m: number): number {
  const c = (v: number) => Math.round(255 * Math.max(0, Math.min(1, v)));
  return (c(m + 0.05) << 16) | (c(m) << 8) | c(m - 0.05);
}

/** The level: a gray rising from black to white and back, eased at each end. */
const level = shaderPatch<Cell, Wipe>(PERIOD, {
  wgsl: `let s = (1.0 - cos(6.28318530718 * phase)) / 2.0;
out.w = array<f32, 4>(select(0.0, pow(s, 1.0 / 3.0), s > 0.0), 0.0, 0.0, 1.0);`,
  at: (phase) => {
    const s = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    // A gray's OKLab lightness is the cube root of its linear value.
    return { w: [Math.cbrt(s), 0, 0, 1] };
  },
  writes: ['w'],
});

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const el = document.createElement('canvas');
  el.width = COLS;
  el.height = ROWS;
  const row = (label: string, names: string[]) => {
    const r = document.createElement('div');
    r.className = 'rig-row';
    const tag = document.createElement('span');
    tag.className = 'rig-label';
    tag.textContent = label;
    r.append(tag);
    const buttons = names.map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = n;
      r.append(b);
      return b;
    });
    return { r, buttons };
  };
  const maps = row('Map', Object.keys(MAPS));
  const modes = row('Mode', Object.keys(MODES));
  const controls = document.createElement('div');
  controls.className = 'rig-row';
  const play = document.createElement('button');
  play.type = 'button';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(PERIOD);
  scrub.step = 'any';
  scrub.ariaLabel = 'Where the level is in its sweep';
  controls.append(play, scrub);
  wrap.append(el, maps.r, modes.r, controls);
  root.append(wrap);

  const cells: Cell[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) cells.push({ x: x / (COLS - 1), y: y / (ROWS - 1), base: 0 });

  // The picks live out here, so one made before the device is ready still counts.
  let mode: Mode = 'hardMix';
  let onMap = () => {};
  let onMode = () => {};
  const paintMap = (name: string) => {
    const f = MAPS[name] as (x: number, y: number) => number;
    for (const c of cells) c.base = base(f(c.x, c.y));
    maps.buttons.forEach((b) => {
      b.ariaPressed = String(b.textContent === name);
    });
    onMap();
  };
  const pickMode = (next: Mode) => {
    mode = next;
    modes.buttons.forEach((b) => {
      b.ariaPressed = String(b.textContent === mode);
    });
    onMode();
  };
  for (const b of maps.buttons) b.addEventListener('click', () => paintMap(b.textContent ?? ''));
  for (const b of modes.buttons) b.addEventListener('click', () => pickMode(b.textContent as Mode));
  paintMap('iris');
  pickMode(mode);

  let stop = () => {};
  let gone = false;
  void gpuDevice().then((device) => {
    if (!gone) stop = start(device);
  });

  function start(device: GpuDevice | null): () => void {
    let grid: Grid | undefined;
    // With the GPU, it folds the level and lays it over the map; the grid holds the map's colors,
    // so a new map or a new mix makes it again.
    const regrid = () => {
      grid?.destroy();
      if (device === null || m === undefined) return;
      gpuOf(m).subjects(cells, () => ({}));
      grid = gpuGrid({
        canvas: el,
        cols: COLS,
        rows: ROWS,
        device,
        side: gpuOf(m),
        channels: [{ name: 'w', axes: 18 }],
        bases: cells.map((c) => c.base),
        body: layStack('w', 'shown'),
        cpu: probed(m, cells),
      });
    };

    // Pausing stops the transport; dragging seeks the level's voice. The slider shows where the
    // level is: the transport's time, shifted by the last drag.
    const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
    let shift = 0;
    const now = () => (Number.isFinite(show.now) ? show.now : 0);
    const place = () => (((now() + shift) % PERIOD) + PERIOD) % PERIOD;
    let m: Mix<Cell, Wipe> | undefined;
    let sweep: Handle | undefined;
    const choose = () => {
      m?.close();
      m = mix<Cell, Wipe>(kit<Wipe>({ w: color(MODES[mode]()) }), {
        name: 'threshold-wipe',
        transport: show,
        ...(device === null ? {} : { engine: gpu({ device }) }),
      });
      sweep = m.cue({ patch: level, subjects: cells, loop: true, seek: place() });
      regrid();
      drawn = -1;
    };
    onMode = choose;
    onMap = () => {
      regrid();
      drawn = -1;
    };

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
      sweep?.seek(to);
      shift = to - now();
    });

    let drawn = -1;
    choose();
    showRate();
    let draw: () => void;
    if (device !== null) draw = () => grid?.draw();
    else {
      const ctx = el.getContext('2d') as CanvasRenderingContext2D;
      const image = ctx.createImageData(COLS, ROWS);
      const pose: Wipe = {};
      draw = () => {
        cells.forEach((c, i) => {
          m?.probe(c, pose);
          const hex = toHex(pose.w ?? NONE, c.base);
          image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
        });
        ctx.putImageData(image, 0, 0);
      };
    }
    const halt = loop(show, root, (t) => {
      show.sync(t);
      scrub.value = String(place());
      if (show.seq === drawn) return;
      drawn = show.seq;
      draw();
    });

    return () => {
      halt();
      onMap = () => {};
      onMode = () => {};
      grid?.destroy();
      m?.close();
    };
  }

  return () => {
    gone = true;
    stop();
  };
}
