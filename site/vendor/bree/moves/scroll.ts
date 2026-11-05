import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import type { Values } from '../params.js';
import { type Joins, LOOSE, move } from './move.js';
import { LIT, litOf, moveShader } from './shader.js';

const PARAMS = {
  direction: {
    label: 'direction',
    choices: ['left', 'right'],
    value: 'left',
    about: 'Which way the message travels.',
  },
  step: {
    label: 'column time',
    min: 10,
    max: 200,
    step: 1,
    value: 45,
    unit: 'ms',
    about: 'How long the message waits before moving one column. Higher scrolls more slowly.',
  },
} as const;
type Scroll = Values<typeof PARAMS>;

/** Where the message's left edge is, in dot columns, off the sign at each end and standing. */
const edges = (at: Placed, p: Scroll) => {
  const left = p.direction === 'left';
  return {
    off: left ? at.board.cols : -at.text.cols,
    away: left ? -at.text.cols : at.board.cols,
    rest: at.left,
  };
};

type Leg = readonly [number, number];

/** The legs a slide takes, its first leg's start to its last leg's end; a lone leg ends standing. */
const twoLegs = (legs: readonly Leg[]): readonly [Leg, Leg] => {
  const [a = [0, 0], b] = legs;
  return [a, b ?? [a[1], a[1]]];
};

/**
 * The left edge `k` columns into a slide along legs `a` then `b`: a later leg starts where the one
 * before left the sign, at the other edge.
 */
function edgeAt([a, b]: readonly [Leg, Leg], k: number) {
  const n = Math.abs(a[1] - a[0]);
  if (k <= n) return a[0] + Math.sign(a[1] - a[0]) * k;
  return b[0] + Math.sign(b[1] - b[0]) * Math.min(k - n, Math.abs(b[1] - b[0]));
}

const totalOf = ([a, b]: readonly [Leg, Leg]) => Math.abs(a[1] - a[0]) + Math.abs(b[1] - b[0]);

const SLIDE = moveShader({
  params: ['a0', 'a1', 'b0', 'b1'],
  wgsl: `let n = abs(params.a1 - params.a0);
let total = n + abs(params.b1 - params.b0);
let k = min(total, floor(phase * total));
var edge = params.a0 + sign(params.a1 - params.a0) * k;
if (k > n) { edge = params.b0 + sign(params.b1 - params.b0) * min(k - n, abs(params.b1 - params.b0)); }
lit = ${LIT('edge')};`,
  at(phase, d, p, t) {
    const legs = [
      [p.a0, p.a1],
      [p.b0, p.b1],
    ] as unknown as [Leg, Leg];
    const total = totalOf(legs);
    return litOf(t, d, edgeAt(legs, Math.min(total, Math.floor(phase * total))));
  },
});

/** The message sliding a whole column at a time, its left edge going along each leg in turn. */
function slide(at: Placed, p: Scroll, ...legs: Leg[]) {
  const both = twoLegs(legs);
  const total = totalOf(both);
  return patch<Led, Pose>(
    Math.max(1, total) * p.step,
    (phase, led) => {
      const x = edgeAt(both, Math.min(total, Math.floor(phase * total)));
      const row = at.rowOf(led);
      return { lit: row >= 0 ? at.text.level(led.x - x, row) : 0 };
    },
    { writes: ['lit'] },
  );
}

/** `slide` as a shader patch. */
function slideShader(at: Placed, p: Scroll, ...legs: Leg[]) {
  const [[a0, a1], [b0, b1]] = twoLegs(legs);
  return SLIDE(at, Math.max(1, totalOf(twoLegs(legs))) * p.step, { a0, a1, b0, b1 });
}

/**
 * The legs scroll-across takes. After an enter move it starts where that left the message
 * standing, and before an exit move it comes round again to stand there, so the effect never jumps.
 */
function across(at: Placed, p: Scroll, joins: Joins): Leg[] {
  const { off, away, rest } = edges(at, p);
  const start = joins.from ? rest : off;
  if (!joins.to) return [[start, away]];
  return start === rest
    ? [
        [rest, away],
        [off, rest],
      ]
    : [[off, rest]];
}

/** The message sliding in from one edge to rest where `stand` shows it. */
export const scrollIn = move({
  name: 'scroll-in',
  about: 'Slides in from an edge and stops where the message stands.',
  slot: 'enter',
  params: PARAMS,
  wide: true,
  patch: (at, p) => slide(at, p, [edges(at, p).off, edges(at, p).rest]),
  shader: (at, p) => slideShader(at, p, [edges(at, p).off, edges(at, p).rest]),
});

/** The message sliding out of an edge from where `stand` shows it. */
export const scrollOut = move({
  name: 'scroll-out',
  about: 'Slides out to an edge, starting where the message stands.',
  slot: 'exit',
  params: PARAMS,
  wide: true,
  patch: (at, p) => slide(at, p, [edges(at, p).rest, edges(at, p).away]),
  shader: (at, p) => slideShader(at, p, [edges(at, p).rest, edges(at, p).away]),
});

/** The message crossing the whole sign, in at one edge and out at the other, as `across` lays out. */
export const scrollAcross = move({
  name: 'scroll-across',
  about:
    'Crosses the sign, in at one edge and out at the other, carrying on from where an enter move leaves the message and coming back round for an exit move.',
  slot: 'active',
  params: PARAMS,
  wide: true,
  patch: (at, p, joins = LOOSE) => slide(at, p, ...across(at, p, joins)),
  shader: (at, p, joins = LOOSE) => slideShader(at, p, ...across(at, p, joins)),
});
