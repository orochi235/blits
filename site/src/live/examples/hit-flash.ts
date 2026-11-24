import {
  color,
  colorDodge,
  difference,
  type GpuDevice,
  gpu,
  gpuOf,
  kit,
  luminosity,
  type Mix,
  mix,
  oklab,
  shaderPatch,
  toHex,
  transport,
} from '@msb235/blits/gpu';
import { demo } from '../demo';
import { type Grid, gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';

interface Cell {
  x: number;
  y: number;
  base: number;
  /** How much of the cell its creature covers, for a flash's edge. */
  cov: number;
  /** Which creature covers the cell, or -1 for none. */
  who: number;
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
/** How long between the hits Auto lands, in ms. */
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

/** A number as a WGSL f32 literal. */
const f32 = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * A flash of white over each cell of creature `who`, or of any creature for -1, over the first
 * `FLASH` ms of a pass `ms` long: held full for its first 40%, then fading out.
 */
const flashing = (ms: number) =>
  shaderPatch<Cell, Flash, { who: number }>(ms, {
    fields: { cov: 'f32', who: 'f32' },
    params: { who: 'f32' },
    wgsl: `let q = phase * ${f32(ms / FLASH)};
  let fade = select((1.0 - q) / ${f32(1 - HOLD)}, 1.0, q < ${f32(HOLD)});
  let mine = subject.who >= 0.0 && (params.who < 0.0 || subject.who == params.who);
  let a = select(0.0, subject.cov, mine && q < 1.0) * fade * fade;
  out.hit = array<f32, 4>(a, 0.0, 0.0, a);`,
    at: (phase, c, _, p) => {
      const q = (phase * ms) / FLASH;
      if (c.who < 0 || (p.who >= 0 && c.who !== p.who) || q >= 1) return {};
      const fade = q < HOLD ? 1 : (1 - q) / (1 - HOLD);
      const a = c.cov * fade * fade;
      return a > 0 ? { hit: [a, 0, 0, a] } : {};
    },
    writes: ['hit'],
  });
const flash = flashing(FLASH);
/** Every creature in turn, one every `EVERY` ms, staggered by creature. */
const rounds = flashing(EVERY * CREATURES.length).with({ who: -1 });

export default demo((d) => {
  const { root } = d;
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const el = document.createElement('canvas');
  el.width = COLS;
  el.height = ROWS;
  el.className = 'rig-target';
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
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const s = scene(x / (COLS - 1), y / (ROWS - 1));
      cells.push({ x: x / (COLS - 1), y: y / (ROWS - 1), base: s.base, cov: s.cov, who: s.who });
    }

  let gone = false;
  d.stops(() => {
    gone = true;
  });
  void gpuDevice().then((device) => {
    if (!gone) start(device);
  });

  function start(device: GpuDevice | null): void {
    const show = transport({ history: d.history(4 * EVERY) });
    let m: Mix<Cell, Flash> | undefined;
    let draw = () => {};
    let grid: Grid | undefined;
    const ctx = device === null ? (el.getContext('2d') as CanvasRenderingContext2D) : undefined;
    const image = ctx?.createImageData(COLS, ROWS);
    const pose: Flash = {};
    const choose = (mode: Mode) => {
      const on = m === undefined || autoOn();
      m?.close();
      grid?.destroy();
      // Room for eight flashes laid on one cell at once.
      const made = mix<Cell, Flash>(
        kit<Flash>({ hit: color(MODES[mode]({ layers: 8 })) }),
        d.options('hit-flash', {
          transport: show,
          ...(device === null ? {} : { engine: gpu({ device }) }),
        }),
      );
      m = made;
      if (device !== null) {
        // The GPU folds the flashes for every cell, and lays their stack over the scene.
        gpuOf(made).subjects(cells, (c) => ({ cov: c.cov, who: c.who }));
        const g = gpuGrid({
          canvas: el,
          cols: COLS,
          rows: ROWS,
          device,
          side: gpuOf(made),
          channels: [{ name: 'hit', axes: 34 }],
          bases: cells.map((c) => c.base),
          body: layStack('hit', 'shown'),
          cpu: probed(made, cells),
        });
        grid = g;
        draw = () => g.draw();
      } else if (ctx !== undefined && image !== undefined) {
        draw = () => {
          cells.forEach((c, i) => {
            made.probe(c, pose);
            const hex = toHex(pose.hit ?? NONE, c.base);
            image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
          });
          ctx.putImageData(image, 0, 0);
        };
      }
      for (const { n, b } of modeButtons) b.ariaPressed = String(n === mode);
      drawn = -1;
      if (on) autoHits();
    };
    // Each hit is one voice over every cell, lighting its creature's, for one pass, leaving when
    // the pass ends. A later `start` is on the host's clock, not the mix's.
    const hit = (who: number, after = 0) => {
      if (m === undefined) return;
      const at = after > 0 ? { start: show.timestamp + after } : {};
      m.cue({ patch: flash.with({ who }), subjects: cells, ...at });
    };
    for (const { n, b } of modeButtons) d.on(b, 'click', () => choose(n));
    d.on(double, 'click', () => {
      hit(1);
      hit(1, 70);
    });
    // Auto is one more voice, looping for good over every cell. Whether it is on is read from the
    // mix, which a seek back puts as it was.
    const autoOn = () => m?.voices('auto').some((v) => v.state !== 'fading') ?? false;
    const autoHits = () => {
      m?.cue({
        patch: rounds,
        subjects: cells,
        loop: true,
        stagger: (c) => Math.max(0, c.who) * EVERY,
        tags: ['auto'],
      });
    };
    const showAuto = () => {
      const on = String(autoOn());
      if (auto.ariaPressed !== on) auto.ariaPressed = on;
    };
    d.on(auto, 'click', () => {
      if (autoOn())
        for (const v of m?.voices('auto') ?? [])
          if (v.state !== 'fading') v.fade({ over: FLASH });
          else autoHits();
      showAuto();
    });
    d.on(el, 'click', (e) => {
      const box = el.getBoundingClientRect();
      const x = Math.floor(((e.clientX - box.left) / box.width) * COLS);
      const y = Math.floor(((e.clientY - box.top) / box.height) * ROWS);
      const s = scene(x / (COLS - 1), y / (ROWS - 1));
      if (s.who >= 0) hit(s.who);
    });

    let drawn = -1;
    choose('difference');
    d.stops(() => {
      grid?.destroy();
      m?.close();
    });
    d.frame(
      show,
      (now) => {
        show.sync(now);
        showAuto();
        if (show.seq === drawn) return;
        drawn = show.seq;
        draw();
      },
      { settle: () => (m ? [m] : []) },
    );
  }
});
