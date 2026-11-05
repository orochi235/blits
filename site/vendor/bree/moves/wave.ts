import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import { LOOSE, move, movedAt, on } from './move.js';
import { type Lookup, MOVED, movedOf, moveShader, ROUND } from './shader.js';

/** How long the wave takes to swell from still, or settle back to it, at most. */
const SWELL = 600;
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * How many waves a pass holds, what share of it the wave swells over, and the column the wave is
 * read at for column `x` of the text.
 */
function shape(at: Placed, p: { ms: number; period: number; by: string }) {
  const { text } = at;
  // A whole number of waves per pass, so a loose one loops without a seam.
  const waves = Math.max(1, Math.round(p.ms / p.period));
  const swell = Math.min(SWELL, p.ms / 4) / p.ms;
  const middles = text.letters.map((s) => s.x + (s.width - 1) / 2);
  const anchor =
    p.by === 'letter'
      ? (x: number) => {
          const k = text.letterAt(x);
          return k >= 0 ? (middles[k] as number) : x;
        }
      : (x: number) => x;
  return { waves, swell, anchor };
}

/** The wave, reading the column it is read at for each column of the text from `anchor`. */
const WAVE = moveShader({
  params: ['left', 'cols', 'height', 'length', 'waves', 'swell', 'from', 'to'],
  wgsl: `let env = select(1.0, bree_smooth(min(1.0, phase / params.swell)), params.from > 0.5)
  * select(1.0, bree_smooth(min(1.0, (1.0 - phase) / params.swell)), params.to > 0.5);
let x = subject.x - params.left;
let a = select(x, table_anchor(x, 0.0), x >= 0.0 && x < params.cols);
let turns = a / params.length - params.waves * phase;
let dy = ${ROUND('params.height * env * sin(6.283185307179586 * (turns - floor(turns)))')};
lit = ${MOVED('params.left', 'dy')};`,
  at(phase, d, p, t) {
    const envelope =
      (p.from ? smooth(Math.min(1, phase / (p.swell as number))) : 1) *
      (p.to ? smooth(Math.min(1, (1 - phase) / (p.swell as number))) : 1);
    const x = d.x - (p.left as number);
    const a = x >= 0 && x < (p.cols as number) ? (t.anchor as Lookup)(x, 0) : x;
    const angle = 2 * Math.PI * (a / (p.length as number) - (p.waves as number) * phase);
    const dy = Math.round((p.height as number) * envelope * Math.sin(angle));
    return movedOf(t, d, p.left as number, dy);
  },
});

/**
 * The message bobbing in a sine wave traveling along it. Beside an enter or exit move it swells
 * from still and settles back, so it starts and ends where they leave or want the message.
 */
export const wave = move({
  name: 'wave',
  about: 'Letters or columns bob up and down in a wave traveling along the message.',
  slot: 'active',
  params: {
    ms: {
      label: 'length',
      min: 500,
      max: 12000,
      step: 100,
      value: 3600,
      unit: 'ms',
      about: 'How long the message waves.',
    },
    height: {
      label: 'height',
      min: 1,
      max: 6,
      step: 1,
      value: 1,
      unit: 'rows',
      about: 'How many rows the wave lifts the message above and drops it below where it stands.',
    },
    length: {
      label: 'wavelength',
      min: 4,
      max: 120,
      step: 1,
      value: 24,
      unit: 'cols',
      about: 'How many columns from one crest to the next. Lower makes a choppier wave.',
    },
    period: {
      label: 'wave time',
      min: 200,
      max: 4000,
      step: 50,
      value: 1200,
      unit: 'ms',
      about: 'How long one crest takes to pass a point. Higher travels more slowly.',
    },
    by: {
      label: 'moves',
      choices: ['letter', 'column'],
      value: 'letter',
      about: 'Whether each letter bobs whole, or every column on its own, bending the letters.',
    },
  },
  patch(at, p, joins = LOOSE) {
    const { waves, swell, anchor } = shape(at, p);
    return patch<Led, Pose>(
      p.ms,
      (phase, led) => {
        const envelope =
          (joins.from ? smooth(Math.min(1, phase / swell)) : 1) *
          (joins.to ? smooth(Math.min(1, (1 - phase) / swell)) : 1);
        const x = led.x - at.left;
        const angle = 2 * Math.PI * (anchor(x) / p.length - waves * phase);
        const dy = Math.round(p.height * envelope * Math.sin(angle));
        return on(movedAt(at, led, dy));
      },
      { writes: ['lit'] },
    );
  },
  shader(at, p, joins = LOOSE) {
    const { waves, swell, anchor } = shape(at, p);
    const cols = at.text.cols;
    const anchors = Array.from({ length: Math.max(1, cols) }, (_, x) => anchor(x));
    return WAVE(
      at,
      p.ms,
      {
        left: at.left,
        cols,
        height: p.height,
        length: p.length,
        waves,
        swell,
        from: joins.from ? 1 : 0,
        to: joins.to ? 1 : 0,
      },
      { anchor: { width: anchors.length, height: 1, data: anchors } },
    );
  },
});
