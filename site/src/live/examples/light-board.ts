import {
  color,
  colorDodge,
  colorMode,
  type Handle,
  kit,
  mix,
  multiply,
  oklab,
  type Patch,
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

/** A layer of `rgb` over a cell, `cov` of it. */
function layer(rgb: number, cov: number): number[] | undefined {
  if (cov <= 0) return undefined;
  const [L = 0, a = 0, b = 0] = oklab(rgb);
  return [L * cov, a * cov, b * cov, cov];
}

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
function spot(rgb: number, cx: number, c: Cell): Light {
  const dx = Math.abs(c.x - cx) * ASPECT;
  const down = Math.min(1, c.y / FLOOR);
  const beam = 0.5 * (0.3 + 0.7 * down) * smooth(1 - dx / (0.06 + 0.26 * down));
  const pool = smooth(1 - Math.hypot(dx, (c.y - FLOOR) * 3) / 0.4);
  const spots = layer(rgb, Math.max(beam, pool));
  return spots === undefined ? {} : { spots };
}

const still = (rgb: number, cx: number) =>
  patch<Cell, Light>(0, (_, c) => spot(rgb, cx, c), { writes: ['spots'] });

/** A spot sweeping across the stage and back over `ms`, starting `lead` of the way in. */
const sweep = (rgb: number, ms: number, lead: number) =>
  patch<Cell, Light>(
    ms,
    (phase, c) => {
      const t = (phase + lead) % 1;
      return spot(rgb, 0.2 + 0.6 * ((1 - Math.cos(2 * Math.PI * t)) / 2), c);
    },
    { writes: ['spots'] },
  );

const wash = (rgb: number) =>
  patch<Cell, Light>(0, () => ({ gel: layer(rgb, 0.7) }), { writes: ['gel'] });

const dark = patch<Cell, Light>(0, () => ({ master: layer(0x000000, 1) }), {
  writes: ['master'],
});

interface Look {
  name: string;
  gel?: number;
  spots: Patch<Cell, Light>[];
  blackout?: boolean;
}

const LOOKS: Look[] = [
  { name: 'Warm', gel: 0xffa850, spots: [still(0xe0c090, 0.25), still(0xe0c090, 0.75)] },
  { name: 'Cool', gel: 0x4a78ff, spots: [sweep(0xa8c0e8, 5000, 0)] },
  {
    name: 'Chase',
    gel: 0xd040c0,
    spots: [0, 1 / 3, 2 / 3].map((lead) => sweep(0xd8b0e0, 3600, lead)),
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
  const ctx = el.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(COLS, ROWS);
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

  const show = transport({ history: { ms: 4 * HOLD, tape: createHistory } });
  const m = mix<Cell, Light>(BOARD, { name: 'light-board', transport: show });

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
      up.push(m.cue({ patch: wash(look.gel), subjects: CELLS, role: 'gel', fade }));
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
  const showRate = () => {
    play.textContent = show.rate === 0 ? 'Play' : 'Pause';
  };
  play.addEventListener('click', () => {
    show.rate = show.rate === 0 ? 1 : 0;
    showRate();
  });
  showRate();

  const pose: Light = {};
  let drawn = -1;
  const stop = loop(show, (now) => {
    show.sync(now);
    if (current < 0) take(0);
    else if (running && show.now - since >= HOLD) take((current + 1) % LOOKS.length);
    if (show.seq === drawn) return;
    drawn = show.seq;
    CELLS.forEach((c, i) => {
      m.probe(c, pose);
      const gelled = toHex(pose.gel ?? NONE, c.base);
      const lit = toHex(pose.spots ?? NONE, gelled);
      const hex = toHex(pose.master ?? NONE, lit);
      image.data.set([hex >> 16, (hex >> 8) & 0xff, hex & 0xff, 255], i * 4);
    });
    ctx.putImageData(image, 0, 0);
  });

  return () => {
    stop();
    m.close();
  };
}
