import { compose } from '@brand/glyphs.js';
import { level, patch, slew } from '@msb235/blits';
import {
  createMarquee,
  type EffectSpec,
  type Face,
  marginOf,
  type Pose,
  type Scene,
  type Subject,
  type Ticker,
} from 'bree';
import { between, CYCLE, GREEN, SHADE, showing, TURNS } from '../explainers/hues';
import { loop } from './loop';

const WORD = compose('blits');

/**
 * Blank rows the face carries above the word, so the sign reaches the top of the page, and below
 * it, where the sign runs on behind the rail's links and search box.
 */
const ABOVE = 3;
const BELOW = 13;

/**
 * The whole wordmark as one glyph, so bree draws it exactly as the brand grid has it, standing on
 * blank rows that moves pass through. bree centers a message with a blank column after it,
 * so the glyph carries one before it to balance, kept by drawing at fixed pitch.
 */
const FACE: Face = {
  name: 'blits',
  rows: ABOVE + WORD.rows + BELOW,
  width: WORD.cols + 1,
  glyph(ch) {
    if (ch !== 'B') return undefined;
    const rows = Array.from({ length: ABOVE + WORD.rows + BELOW }, () =>
      Array(WORD.cols + 1).fill('.'),
    );
    for (const [c, r] of WORD.lit) rows[r + ABOVE][c + 1] = '#';
    return rows.map((r) => r.join(''));
  },
};
const LOOK = { text: 'B', face: FACE, style: { monospace: true } } as const;

const STILL: EffectSpec = { name: 'still', active: { move: 'stand' } };

/** How long the wordmark stands between one effect and the next. */
const REST = 14_000;

const EFFECTS = ['swarm', 'fall', 'flip', 'matris', 'bounce', 'hold'] as const;

/** Standing still first, since every page load starts the program over; then an effect a scene. */
function program(still: boolean): Scene[] {
  const standing: Scene = { ...LOOK, hex: GREEN, effect: STILL, hold: REST };
  if (still) return [standing];
  return [standing, ...EFFECTS.map((effect) => ({ ...LOOK, hex: GREEN, effect, hold: REST }))];
}

/** How long a change of hue takes to cross the sign, and how long each dot takes to turn. */
const SWEEP = 900;
const TURN = 320;

/**
 * Where each change of hue reaches a dot first, as a share of `SWEEP`: one way of crossing the sign
 * for each change, in turn, from a dot's place on a sign `cols` x `rows`.
 */
const CROSSINGS: ((x: number, y: number, cols: number, rows: number) => number)[] = [
  (x, _y, cols) => x / cols,
  (_x, y, _cols, rows) => 1 - y / rows,
  (x, y, cols, rows) => Math.hypot(x / cols - 0.5, (y / rows - 0.5) * (rows / cols)) * 1.9,
  (x, y) => (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) % 1,
  (x, _y, cols) => 1 - x / cols,
  (x, y, cols, rows) => (x / cols + y / rows) / 2,
];

/** When, into each hue's `SHADE`, the change to the next one sets out. */
const LEAVE = SHADE - SWEEP - TURN;

/** How far a dot `cross` along the change out of hue `k` has turned, 0 to 1, `into` ms into it. */
function turnedBy(into: number, cross: number): number {
  const u = Math.min(1, Math.max(0, (into - LEAVE - cross * SWEEP) / TURN));
  return u * u * (3 - 2 * u);
}

/** Each dot's turn of the brand green over one pass of every hue, changing by `CROSSINGS`. */
function hues(cols: number, rows: number) {
  return patch<Subject, Pose>(
    CYCLE,
    (phase, dot) => {
      if (dot.kind !== 'dot') return {};
      const t = phase * CYCLE;
      const k = Math.min(TURNS.length - 1, Math.floor(t / SHADE));
      const from = TURNS[k];
      const to = TURNS[(k + 1) % TURNS.length];
      const cross = CROSSINGS[k % CROSSINGS.length](dot.x, dot.y, cols, rows);
      return { hue: from + between(from, to) * turnedBy(t - k * SHADE, cross) };
    },
    { writes: ['hue'] },
  );
}

/** Lights the dots round the pointer, turning their hue as they go; `around` shapes it into a halo. */
const GLOW = patch<Subject, Pose>(1000, () => ({ lit: 0.5, hue: 60 }), { writes: ['lit', 'hue'] });

/** The halo's radius, in dot pitches. */
const REACH = 5;

/** Sets `showing` from where the logo's hues stand, `t` ms into a pass, as its middle dot sees them. */
function publish(t: number | null) {
  const at = t === null ? 0 : ((t % CYCLE) + CYCLE) % CYCLE;
  const k = Math.min(TURNS.length - 1, Math.floor(at / SHADE));
  const u = t === null ? 0 : turnedBy(at - k * SHADE, 0.5);
  const next = (k + 1) % TURNS.length;
  for (const [i, l] of showing.entries()) l.set(i === k ? 1 - u : i === next ? u : 0);
}

/**
 * Plays the wordmark on `canvas` as a bree sign, synced while the site's live demos are, focus or not.
 * Its hue turns on a voice of its own, apart from the program moving its dots, and `showing` tells
 * other mixes which hue it is on. Pointing at it, or focusing its link, runs a rainbow across it,
 * and a halo of lit dots follows the pointer. On a
 * dark page the dots stand on the page itself; on a light one, where green would wash out, they
 * keep the sign's dark housing. A sign's housing is set when it is made, so a change of theme makes
 * it again.
 */
export function playLogo(canvas: HTMLCanvasElement): () => void {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let stop = start();

  function start(): () => void {
    const fns = new Set<(now: number) => void>();
    const ticker: Ticker = {
      add(fn) {
        fns.add(fn);
        return () => fns.delete(fn);
      },
      get size() {
        return fns.size;
      },
    };
    const sign = createMarquee(canvas, {
      name: 'logo',
      cols: WORD.cols + 2 + 2 * marginOf(false),
      rows: ABOVE + WORD.rows + BELOW + 2 * marginOf(false),
      border: false,
      housing: dark.matches ? 'none' : 'dark',
      program: program(calm.matches),
      ticker,
    });
    const m = sign.mix;
    const { cols, rows, dots } = sign.board;
    // Cued before the mix's first frame, a voice starts at its time 0.
    const from = Number.isNaN(m.now) ? 0 : m.now;
    const turning = m.cue({ name: 'hues', patch: hues(cols, rows), subjects: dots, loop: true });
    const recolor = () => {
      sign.setProgram(program(calm.matches));
      turning.weight = calm.matches ? 0 : 1;
    };
    recolor();
    calm.addEventListener('change', recolor);
    const host = canvas.parentElement ?? canvas;
    const xy = new Float64Array(dots.length * 2);
    for (const [i, d] of dots.entries()) {
      xy[2 * i] = d.x;
      xy[2 * i + 1] = d.y;
    }
    m.plot(dots, xy);
    const pointer = { x: 0, y: 0, r: REACH };
    const near = level<Subject>();
    const halo = m.owns({ name: 'halo', weight: slew(near, { riseMs: 150, fallMs: 500 }) });
    m.cue({
      name: 'halo',
      owner: halo,
      patch: GLOW,
      subjects: dots,
      loop: true,
      weight: m.around(pointer, { ease: 'ease-out' }),
    });
    const follow = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const pitch = box.width / (cols + 2 * sign.board.margin);
      pointer.x = (e.clientX - box.left) / pitch - sign.board.margin - 0.5;
      pointer.y = (e.clientY - box.top) / pitch - sign.board.margin - 0.5;
    };
    const lit = (on: boolean) => () => {
      sign.setLayer('rainbow', on);
      near.set(on ? 1 : 0);
    };
    const hovers = [
      ['pointerenter', lit(true)],
      ['pointerleave', lit(false)],
      ['focus', lit(true)],
      ['blur', lit(false)],
    ] as const;
    for (const [type, fn] of hovers) host.addEventListener(type, fn);
    host.addEventListener('pointermove', follow);
    const halt = loop(
      m,
      canvas,
      (now) => {
        for (const fn of fns) fn(now);
        publish(calm.matches || Number.isNaN(m.now) ? null : m.now - from);
      },
      { focus: false },
    );
    return () => {
      halt();
      calm.removeEventListener('change', recolor);
      for (const [type, fn] of hovers) host.removeEventListener(type, fn);
      host.removeEventListener('pointermove', follow);
      sign.destroy();
    };
  }

  const rebuild = () => {
    stop();
    stop = start();
  };
  dark.addEventListener('change', rebuild);
  return () => {
    dark.removeEventListener('change', rebuild);
    stop();
  };
}
