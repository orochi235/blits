import {
  color,
  divide,
  type GpuDevice,
  gpu,
  gpuOf,
  type Handle,
  keys,
  kit,
  mix,
  multiply,
  oklab,
  toHex,
  transport,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';
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
/** The light drifting warm, then cool, then warm again, into `channel`. */
const drift = (channel: keyof Balance) =>
  keys<Cell, Balance>(
    PERIOD,
    [
      { at: 0, delta: { [channel]: WARM } },
      { at: 0.5, delta: { [channel]: COOL } },
      { at: 1, delta: { [channel]: WARM } },
    ],
    { ease: 'ease-in-out' },
  );
const cast = drift('cast');
const fix = drift('fix');

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
    return { fig, el, read };
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

  let stop = () => {};
  let gone = false;
  void gpuDevice().then((device) => {
    if (!gone) stop = start(device);
  });

  function start(device: GpuDevice | null): () => void {
    // Both voices loop on one period, cued together, so the correction divides by the very color
    // the cast multiplies by, whichever way the light has drifted. Their weights are the sliders.
    const show = transport({ history: { ms: 2 * PERIOD, tape: createHistory } });
    const m = mix<Cell, Balance>(BALANCE, {
      name: 'white-balance',
      transport: show,
      ...(device === null ? {} : { engine: gpu({ device }) }),
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
    const readouts = () => {
      m.probe(card, pose);
      const under = toHex(pose.cast ?? NONE, card.base);
      lightOnly.read.textContent = reading(under);
      corrected.read.textContent = reading(toHex(pose.fix ?? NONE, under));
    };
    let draw: () => void;
    let free = () => {};
    if (device !== null) {
      // The GPU folds both channels for every cell, and lays them over the scene for each view.
      gpuOf(m).subjects(CELLS, () => ({}));
      const grid = (el: HTMLCanvasElement, body: string) =>
        gpuGrid({
          canvas: el,
          cols: COLS,
          rows: ROWS,
          device,
          side: gpuOf(m),
          channels: [
            { name: 'cast', axes: 4 },
            { name: 'fix', axes: 18 },
          ],
          bases: CELLS.map((c) => c.base),
          body,
          cpu: probed(m, CELLS),
        });
      const lit = grid(lightOnly.el, 'shown = blits_over_free(c4_cast(i), under);');
      const both = grid(
        corrected.el,
        `shown = blits_over_free(c4_cast(i), under); ${layStack('fix', 'shown')}`,
      );
      draw = () => {
        lit.draw();
        both.draw();
      };
      free = () => {
        lit.destroy();
        both.destroy();
      };
    } else {
      const ctxOf = (el: HTMLCanvasElement) => el.getContext('2d') as CanvasRenderingContext2D;
      const a = { ctx: ctxOf(lightOnly.el), image: new ImageData(COLS, ROWS) };
      const b = { ctx: ctxOf(corrected.el), image: new ImageData(COLS, ROWS) };
      draw = () => {
        CELLS.forEach((c, i) => {
          m.probe(c, pose);
          const under = toHex(pose.cast ?? NONE, c.base);
          put(a.image, i, under);
          put(b.image, i, toHex(pose.fix ?? NONE, under));
        });
        a.ctx.putImageData(a.image, 0, 0);
        b.ctx.putImageData(b.image, 0, 0);
      };
    }
    let drawn = -1;
    const stop = loop(show, root, (now) => {
      show.sync(now);
      if (show.seq === drawn) return;
      drawn = show.seq;
      draw();
      readouts();
    });

    return () => {
      stop();
      free();
      m.close();
    };
  }

  return () => {
    gone = true;
    stop();
  };
}
