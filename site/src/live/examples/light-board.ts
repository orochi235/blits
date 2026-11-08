import {
  color,
  colorDodge,
  colorMode,
  type GpuDevice,
  gpu,
  gpuOf,
  type Handle,
  keys,
  kit,
  mix,
  multiply,
  oklab,
  type Patch,
  shaderPatch,
  toHex,
  transport,
} from '@msb235/blits/gpu';
import { createHistory } from '@weasel-js/history';
import { gpuDevice, gpuGrid, layStack, probed } from '../gpu-grid';
import { loop } from '../loop';
import { playPause } from '../play';

interface Cell {
  x: number;
  y: number;
  base: number;
}
interface Light {
  gel?: number[];
  spots?: number[];
  master?: number[];
}

// Laid on the set in this order: the gel recolors it, the spots dodge pools of light into it, and
// the master multiplies the lot down.
const BOARD = kit<Light>({
  gel: color(colorMode()),
  spots: color(colorDodge({ layers: 6 })),
  master: color(multiply()),
});

const COLS = 144;
const ROWS = 72;
const ASPECT = COLS / ROWS;
const NONE = [0, 0, 0, 0];

/** A color in OKLab, as a patch's parameters. */
interface Lab extends Record<string, number> {
  L: number;
  A: number;
  B: number;
}
const lab = (rgb: number): Lab => {
  const [L = 0, A = 0, B = 0] = oklab(rgb);
  return { L, A, B };
};

/** A layer of `c` over a cell, `cov` of it. */
function layer(c: Lab, cov: number): number[] | undefined {
  if (cov <= 0) return undefined;
  return [c.L * cov, c.A * cov, c.B * cov, cov];
}

/** A number as a WGSL f32 literal. */
const f32 = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/** The set: a back wall, a floor, three pillars, and curtains at the sides. */
function set(x: number, y: number): number {
  if (x < 0.06 || x > 0.94) return 0x3a1418;
  const pillar = [0.25, 0.5, 0.75].some((p) => Math.abs(x - p) < 0.035) && y < 0.72;
  if (pillar) return 0x5a564e;
  if (y > 0.72) return 0x3c3832;
  return toHex([0.26 + 0.08 * y, -0.01, -0.03, 1], 0) as number;
}

const CELLS: Cell[] = [];
for (let y = 0; y < ROWS; y++)
  for (let x = 0; x < COLS; x++) {
    const u = x / (COLS - 1);
    const v = y / (ROWS - 1);
    CELLS.push({ x: u, y: v, base: set(u, v) });
  }

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Where the spots land on the floor. */
const FLOOR = 0.84;

/** A spot hung above `cx`: a beam widening down to a pool on the floor, squashed by the angle. */
function spot(c: Lab, cx: number, cell: Cell): Light {
  const dx = Math.abs(cell.x - cx) * ASPECT;
  const down = Math.min(1, cell.y / FLOOR);
  const beam = 0.5 * (0.3 + 0.7 * down) * smooth(1 - dx / (0.06 + 0.26 * down));
  const pool = smooth(1 - Math.hypot(dx, (cell.y - FLOOR) * 3) / 0.4);
  const spots = layer(c, Math.max(beam, pool));
  return spots === undefined ? {} : { spots };
}
/** The same spot in WGSL, for the GPU. */
const SPOT_WGSL = `fn board_smooth(t: f32) -> f32 {
  let u = clamp(t, 0.0, 1.0);
  return u * u * (3.0 - 2.0 * u);
}
fn board_spot(L: f32, A: f32, B: f32, cx: f32, x: f32, y: f32) -> array<f32, 4> {
  let dx = abs(x - cx) * ${f32(ASPECT)};
  let down = min(1.0, y / ${f32(FLOOR)});
  let beam = 0.5 * (0.3 + 0.7 * down) * board_smooth(1.0 - dx / (0.06 + 0.26 * down));
  let pool = board_smooth(1.0 - length(vec2f(dx, (y - ${f32(FLOOR)}) * 3.0)) / 0.4);
  let cov = max(beam, pool);
  if (cov <= 0.0) { return array<f32, 4>(0.0, 0.0, 0.0, 0.0); }
  return array<f32, 4>(L * cov, A * cov, B * cov, cov);
}`;
const FIELDS = { x: 'f32', y: 'f32' } as const;
const COLOR = { L: 'f32', A: 'f32', B: 'f32' } as const;

/** A spot standing still above `cx`. */
const still = shaderPatch<Cell, Light, Lab & { cx: number }>(0, {
  helpers: SPOT_WGSL,
  fields: FIELDS,
  params: { ...COLOR, cx: 'f32' },
  wgsl: 'out.spots = board_spot(params.L, params.A, params.B, params.cx, subject.x, subject.y);',
  at: (_, c, __, p) => spot(p, p.cx, c),
  writes: ['spots'],
});

/** A spot sweeping across the stage and back over `ms`, starting `lead` of the way in. */
const sweep = (ms: number) =>
  shaderPatch<Cell, Light, Lab & { lead: number }>(ms, {
    helpers: SPOT_WGSL,
    fields: FIELDS,
    params: { ...COLOR, lead: 'f32' },
    wgsl: `let t = fract(phase + params.lead);
    let cx = 0.2 + 0.6 * ((1.0 - cos(6.28318530718 * t)) / 2.0);
    out.spots = board_spot(params.L, params.A, params.B, cx, subject.x, subject.y);`,
    at: (phase, c, _, p) => {
      const t = (phase + p.lead) % 1;
      return spot(p, 0.2 + 0.6 * ((1 - Math.cos(2 * Math.PI * t)) / 2), c);
    },
    writes: ['spots'],
  });
const slowSweep = sweep(5000);
const fastSweep = sweep(3600);

/** A gel of `rgb` laid over the whole stage. */
const wash = (rgb: number) =>
  keys<Cell, Light>(0, [{ at: 0, delta: { gel: layer(lab(rgb), 0.7) } }]);

const dark = keys<Cell, Light>(0, [{ at: 0, delta: { master: [0, 0, 0, 1] } }]);

interface Look {
  name: string;
  gel?: Patch<Cell, Light>;
  spots: Patch<Cell, Light>[];
  blackout?: boolean;
}

const LOOKS: Look[] = [
  {
    name: 'Warm',
    gel: wash(0xffa850),
    spots: [0.25, 0.75].map((cx) => still.with({ ...lab(0xe0c090), cx })),
  },
  { name: 'Cool', gel: wash(0x4a78ff), spots: [slowSweep.with({ ...lab(0xa8c0e8), lead: 0 })] },
  {
    name: 'Chase',
    gel: wash(0xd040c0),
    spots: [0, 1 / 3, 2 / 3].map((lead) => fastSweep.with({ ...lab(0xd8b0e0), lead })),
  },
  { name: 'Blackout', spots: [], blackout: true },
];

/** How long a look takes to come up and the last one to go. */
const FADE = 900;
/** How long each look holds while the board runs the show by itself. */
const HOLD = 4000;

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const el = document.createElement('canvas');
  el.width = COLS;
  el.height = ROWS;
  const row = document.createElement('div');
  row.className = 'rig-row';
  const buttons = LOOKS.map((look) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = look.name;
    row.append(b);
    return b;
  });
  const auto = document.createElement('button');
  auto.type = 'button';
  auto.textContent = 'Run the show';
  const play = document.createElement('button');
  play.type = 'button';
  row.append(auto, play);
  wrap.append(el, row);
  root.append(wrap);

  let stop = () => {};
  let gone = false;
  void gpuDevice().then((device) => {
    if (!gone) stop = start(device);
  });

  function start(device: GpuDevice | null): () => void {
    const show = transport({ history: { ms: 4 * HOLD, tape: createHistory } });
    const m = mix<Cell, Light>(BOARD, {
      name: 'light-board',
      transport: show,
      ...(device === null ? {} : { engine: gpu({ device }) }),
    });

    // Gels share a role, so a change of look crossfades one gel into the next rather than stacking
    // them. Spots and the blackout come up and go on their own fades.
    let up: Handle[] = [];
    let current = -1;
    let since = 0;
    let running = true;
    const fade = { in: FADE, out: FADE };
    const take = (i: number) => {
      const look = LOOKS[i] as Look;
      for (const h of up) h.fade();
      up = look.spots.map((p) => m.cue({ patch: p, subjects: CELLS, loop: true, fade }));
      if (look.gel !== undefined)
        up.push(m.cue({ patch: look.gel, subjects: CELLS, role: 'gel', fade }));
      if (look.blackout) up.push(m.cue({ patch: dark, subjects: CELLS, fade }));
      current = i;
      since = show.now;
      buttons.forEach((b, j) => {
        b.ariaPressed = String(j === i);
      });
      auto.ariaPressed = String(running);
    };
    buttons.forEach((b, i) => {
      b.addEventListener('click', () => {
        running = false;
        take(i);
      });
    });
    auto.addEventListener('click', () => {
      running = true;
      take((current + 1) % LOOKS.length);
    });
    playPause(show, play);

    let draw: () => void;
    let free = () => {};
    if (device !== null) {
      // The GPU folds every channel for every cell, and lays gel, spots, and master over the set.
      gpuOf(m).subjects(CELLS, (c) => ({ x: c.x, y: c.y }));
      const grid = gpuGrid({
        canvas: el,
        cols: COLS,
        rows: ROWS,
        device,
        side: gpuOf(m),
        channels: [
          { name: 'gel', axes: 18 },
          { name: 'spots', axes: 26 },
          { name: 'master', axes: 4 },
        ],
        bases: CELLS.map((c) => c.base),
        body: `${layStack('gel', 'shown')} ${layStack('spots', 'shown')} shown = blits_over_free(c4_master(i), shown);`,
        cpu: probed(m, CELLS),
      });
      draw = () => grid.draw();
      free = () => grid.destroy();
    } else {
      const ctx = el.getContext('2d') as CanvasRenderingContext2D;
      const image = ctx.createImageData(COLS, ROWS);
      const pose: Light = {};
      draw = () => {
        CELLS.forEach((c, i) => {
          m.probe(c, pose);
          const gelled = toHex(pose.gel ?? NONE, c.base);
          const lit = toHex(pose.spots ?? NONE, gelled);
          const hex = toHex(pose.master ?? NONE, lit);
          image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
        });
        ctx.putImageData(image, 0, 0);
      };
    }

    let drawn = -1;
    const stop = loop(
      show,
      root,
      (now) => {
        show.sync(now);
        if (current < 0) take(0);
        else if (running && show.now - since >= HOLD) take((current + 1) % LOOKS.length);
        if (show.seq === drawn) return;
        drawn = show.seq;
        draw();
      },
      { settle: [m] },
    );

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
