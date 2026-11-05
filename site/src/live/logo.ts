import { level, patch, slew } from '@msb235/blits';
import {
  createMarquee,
  type EffectSpec,
  type Face,
  type Pose,
  type Scene,
  type Subject,
  type Ticker,
} from 'bree';
import { CYCLE, followLogo, GREEN, hueAt, steered } from '../explainers/hues';
import { loop } from './loop';
import { ABOVE, BELOW, SIGN, WORD } from './sign';

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

/** Each dot's turn of the brand green over one pass of every hue. */
function hues(cols: number, rows: number) {
  return patch<Subject, Pose>(
    CYCLE,
    (phase, dot) =>
      dot.kind === 'dot' ? { hue: hueAt(phase * CYCLE, dot.x, dot.y, cols, rows) } : {},
    { writes: ['hue'] },
  );
}

/** Lights the dots round the pointer, turning their hue as they go; `around` shapes it into a halo. */
const GLOW = patch<Subject, Pose>(1000, () => ({ lit: 0.5, hue: 60 }), { writes: ['lit', 'hue'] });

/** The halo's radius, in dot pitches. */
const REACH = 5;

/**
 * Plays the wordmark on `canvas` as a bree sign, synced while the site's live demos are, focus or not.
 * Its hue turns on a voice of its own, apart from the program moving its dots, and `logoAt` tells
 * other mixes where in its pass of hues it is. Pointing at it, or focusing its link, runs a rainbow across it,
 * and a halo of lit dots follows the pointer. On a
 * dark page the dots stand on the page itself; on a light one, where green would wash out, they
 * keep the sign's dark housing. A sign's housing is set when it is made, so a change of theme makes
 * it again.
 */
export function playLogo(canvas: HTMLCanvasElement): () => void {
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  /** How far into a pass of its hues the logo is, ms, kept across a remake of the sign. */
  let place = 0;
  followLogo(() => place);
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
      cols: SIGN.cols,
      rows: SIGN.rows,
      border: false,
      housing: dark.matches ? 'none' : 'dark',
      program: program(calm.matches),
      ticker,
    });
    const m = sign.mix;
    const { cols, rows, dots } = sign.board;
    // A sign made again, on a change of theme, takes up its hues where the last one left them.
    const turning = m.cue({
      name: 'hues',
      patch: hues(cols, rows),
      subjects: dots,
      loop: true,
      seek: place,
    });
    let then = Number.NaN;
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
        const to = steered();
        if (to !== null) {
          place = ((to % CYCLE) + CYCLE) % CYCLE;
          turning.seek(place);
        }
        for (const fn of fns) fn(now);
        if (to === null && !Number.isNaN(then)) place = (place + m.now - then) % CYCLE;
        then = m.now;
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
