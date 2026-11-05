import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import type { Values } from '../params.js';
import { litAt, move, on } from './move.js';
import { LIT, type Lookup, litOf, moveShader, ROUND } from './shader.js';

const SPLIT_PARAMS = {
  ms: {
    label: 'slide time',
    min: 200,
    max: 4000,
    step: 50,
    value: 900,
    unit: 'ms',
    about: 'How long the two halves take to slide between the edges and the message.',
  },
  direction: {
    label: 'top half',
    choices: ['left', 'right'],
    value: 'left',
    about:
      'Which edge the top half of the message slides from or to; the bottom half takes the other.',
  },
} as const;
type Split = Values<typeof SPLIT_PARAMS>;

const easeOut = (u: number) => 1 - (1 - u) ** 3;

/** `halves` at `away`, eased in as split-in plays it or, with `out`, out as split-out does. */
const SPLIT = moveShader({
  params: ['left', 'middle', 'fromLeft', 'fromRight', 'topLeft', 'out'],
  wgsl: `let u = select(phase, 1.0 - phase, params.out > 0.5);
let away = (1.0 - u) * (1.0 - u) * (1.0 - u);
let goesLeft = (row < params.middle) == (params.topLeft > 0.5);
let dx = select(${ROUND('params.fromRight * away')}, -${ROUND('params.fromLeft * away')}, goesLeft);
lit = ${LIT('params.left + dx')};`,
  at(phase, d, p, t) {
    const away = 1 - easeOut(p.out ? 1 - phase : phase);
    const row = (t.rows as Lookup)(0, d.y) - 1;
    const goesLeft = row < (p.middle as number) === (p.topLeft as number) > 0.5;
    const dx = goesLeft
      ? -Math.round((p.fromLeft as number) * away)
      : Math.round((p.fromRight as number) * away);
    return litOf(t, d, (p.left as number) + dx);
  },
});

/**
 * The message's top half `away` of the way off one edge and its bottom half as far off the other,
 * 0 standing and 1 gone; the halves meet at the middle of the letters' body.
 */
function halves(at: Placed, p: Split) {
  const { text } = at;
  const middle = text.above + Math.ceil((text.rows - text.above - text.below) / 2);
  const fromLeft = at.left + text.cols;
  const fromRight = at.board.cols - at.left;
  /** The halves as a shader patch, coming in or, with `out`, going out. */
  const shader = (out: boolean) =>
    SPLIT(at, p.ms, {
      left: at.left,
      middle,
      fromLeft,
      fromRight,
      topLeft: p.direction === 'left' ? 1 : 0,
      out: out ? 1 : 0,
    });
  const draw = (away: number, led: Led) => {
    const top = at.rowOf(led) < middle;
    const left = top === (p.direction === 'left');
    const dx = left ? -Math.round(fromLeft * away) : Math.round(fromRight * away);
    return on(litAt(at, led, dx));
  };
  return { draw, shader };
}

/** The message's halves sliding in from opposite edges to meet where it stands. */
export const splitIn = move({
  name: 'split-in',
  about:
    'The top half slides in from one edge and the bottom half from the other, meeting in place.',
  slot: 'enter',
  params: SPLIT_PARAMS,
  patch(at, p) {
    const { draw } = halves(at, p);
    return patch<Led, Pose>(p.ms, (phase, led) => draw(1 - easeOut(phase), led), {
      writes: ['lit'],
    });
  },
  shader: (at, p) => halves(at, p).shader(false),
});

/** The message's halves sliding apart and out at opposite edges. */
export const splitOut = move({
  name: 'split-out',
  about: 'The top half slides out at one edge and the bottom half at the other.',
  slot: 'exit',
  params: SPLIT_PARAMS,
  patch(at, p) {
    const { draw } = halves(at, p);
    return patch<Led, Pose>(p.ms, (phase, led) => draw(1 - easeOut(1 - phase), led), {
      writes: ['lit'],
    });
  },
  shader: (at, p) => halves(at, p).shader(true),
});
