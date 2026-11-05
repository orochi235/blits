import { compose } from '@brand/glyphs.js';
import { createMarquee, type EffectSpec, type Face, marginOf, type Scene, type Ticker } from 'bree';
import { loop } from './loop';

const WORD = compose('blits');

/**
 * The whole wordmark as one glyph, so bree draws it exactly as the brand grid has it. bree centers a
 * message with a blank column after it, so the glyph carries one before it to balance, kept by
 * drawing at fixed pitch.
 */
const FACE: Face = {
  name: 'blits',
  rows: WORD.rows,
  width: WORD.cols + 1,
  glyph(ch) {
    if (ch !== 'B') return undefined;
    const rows = Array.from({ length: WORD.rows }, () => Array(WORD.cols + 1).fill('.'));
    for (const [c, r] of WORD.lit) rows[r][c + 1] = '#';
    return rows.map((r) => r.join(''));
  },
};
const LOOK = { text: 'B', face: FACE, style: { monospace: true } } as const;

const STILL: EffectSpec = { name: 'still', active: { move: 'stand' } };

/** How long the wordmark stands between one effect and the next. */
const REST = 14_000;

const EFFECTS = ['swarm', 'fall', 'flip', 'matris', 'bounce', 'hold'] as const;

/** The brand green first, then other LED colors, each bright enough to read on a dark ground. */
const COLORS = [0xb2e81b, 0xffb02e, 0x4ad8ff, 0xff6ad5, 0xffe14a, 0xff5a4a];

/** Standing still first, since every page load starts the program over; then an effect a scene. */
function program(still: boolean): Scene[] {
  const standing: Scene = { ...LOOK, hex: COLORS[0], effect: STILL, hold: REST };
  if (still) return [standing];
  return [
    standing,
    ...EFFECTS.map((effect, k) => ({
      ...LOOK,
      hex: COLORS[(k + 1) % COLORS.length],
      effect,
      hold: REST,
    })),
  ];
}

/**
 * Plays the wordmark on `canvas` as a bree sign, synced while the site's live demos are, focus or not. On a
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
      rows: WORD.rows + 2 * marginOf(false),
      border: false,
      housing: dark.matches ? 'none' : 'dark',
      program: program(calm.matches),
      ticker,
    });
    const recolor = () => sign.setProgram(program(calm.matches));
    calm.addEventListener('change', recolor);
    const halt = loop(
      sign.mix,
      canvas,
      (now) => {
        for (const fn of fns) fn(now);
      },
      { focus: false },
    );
    return () => {
      halt();
      calm.removeEventListener('change', recolor);
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
