import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { hash } from '../hash.js';
import type { Placed } from '../orders.js';
import type { Values } from '../params.js';
import { hashThreshold } from '../render/wgsl-hash.js';
import { litAt, move } from './move.js';
import { LIT, type Lookup, litOf, moveShader } from './shader.js';

const RAIN_PARAMS = {
  ms: {
    label: 'rain time',
    min: 300,
    max: 6000,
    step: 50,
    value: 2200,
    unit: 'ms',
    about: 'How long the rain lasts, from the first drop to the last. Higher falls more slowly.',
  },
  drops: {
    label: 'drops',
    min: 1,
    max: 8,
    step: 1,
    value: 3,
    about: 'How many streams fall down each column.',
  },
  tail: {
    label: 'tail',
    min: 1,
    max: 20,
    step: 1,
    value: 3,
    unit: 'dots',
    about: 'How many fading dots trail behind each falling one. Higher makes longer streaks.',
  },
  spread: {
    label: 'stagger',
    min: 0,
    max: 0.9,
    step: 0.05,
    value: 0.6,
    about:
      'How scattered the streams’ start times are. At 0 they all fall at once; higher spreads them out, and each falls faster to make up the time.',
  },
  churn: {
    label: 'churn',
    min: 0,
    max: 60,
    step: 1,
    value: 24,
    about:
      'How often the dots in a tail flicker, like changing characters. At 0 tails stay steady.',
  },
};
type Rain = Values<typeof RAIN_PARAMS>;

/** When each stream starts, as a share of the pass: `drops` a column, a list a column. */
const delaysOf = (at: Placed, p: Rain) =>
  Array.from({ length: at.board.cols }, (_, x) =>
    Array.from({ length: p.drops }, (_, j) => p.spread * hash(x, j, at.board.rows)),
  );

/** A tail dot churns dim where its hash falls below this. */
const BRIGHT = 0.7;

/**
 * `rain`, reading each column's streams' delays from `delays`, a row a column, and showing the
 * message where a stream has passed or, with `out`, where none has.
 */
const RAIN = moveShader({
  params: ['left', 'drops', 'spread', 'tail', 'churn', 'out', 'span'],
  wgsl: `var passed = false;
var l = 0.0;
for (var j = 0.0; j < params.drops; j += 1.0) {
  let u = clamp((phase - table_delays(j, subject.x)) / (1.0 - params.spread), 0.0, 1.0);
  let behind = floor(-1.0 + u * params.span) - subject.y;
  if (behind > 0.0) { passed = true; }
  if (behind == 0.0) {
    l = 1.0;
  } else if (behind > 0.0 && behind <= params.tail) {
    let h = bree_hash_u32(i32(subject.x), i32(subject.y), i32(floor(phase * params.churn)));
    l = max(l, (1.0 - behind / (params.tail + 1.0)) * select(0.3, 1.0, h < ${hashThreshold(BRIGHT)}u));
  }
}
lit = max(l, select(0.0, ${LIT('params.left')}, passed != (params.out > 0.5)));`,
  at(phase, d, p, t) {
    const delays = t.delays as Lookup;
    const [spread, tail, span] = [p.spread as number, p.tail as number, p.span as number];
    let passed = false;
    let lit = 0;
    for (let j = 0; j < (p.drops as number); j++) {
      const u = Math.min(1, Math.max(0, (phase - delays(j, d.x)) / (1 - spread)));
      const behind = Math.floor(-1 + u * span) - d.y;
      if (behind > 0) passed = true;
      if (behind === 0) lit = 1;
      else if (behind > 0 && behind <= tail) {
        const flick = hash(d.x, d.y, Math.floor(phase * (p.churn as number))) < BRIGHT ? 1 : 0.3;
        lit = Math.max(lit, (1 - behind / (tail + 1)) * flick);
      }
    }
    return Math.max(lit, passed !== (p.out as number) > 0.5 ? litOf(t, d, p.left as number) : 0);
  },
});

/** `rain` as a shader patch, showing the message once passed or, with `out`, until passed. */
function rainShader(at: Placed, p: Rain, out: boolean) {
  const rows = at.board.rows;
  const delays = delaysOf(at, p).flat();
  return RAIN(
    at,
    p.ms,
    {
      left: at.left,
      drops: p.drops,
      spread: p.spread,
      tail: p.tail,
      churn: p.churn,
      out: out ? 1 : 0,
      span: rows + p.tail + 1,
    },
    { delays: { width: p.drops, height: at.board.cols, data: delays } },
  );
}

/**
 * `drops` streams per column, each starting at its own random delay and falling past the bottom
 * with its tail; `shown(led, passed)` is how brightly a dot shows the message once some drop has
 * or while none has passed it.
 */
function rain(at: Placed, p: Rain, shown: (led: Led, passed: boolean) => number | false) {
  const rows = at.board.rows;
  const delays = delaysOf(at, p);
  return (phase: number, led: Led) => {
    let passed = false;
    let lit = 0;
    for (const delay of delays[led.x] ?? []) {
      const u = Math.min(1, Math.max(0, (phase - delay) / (1 - p.spread)));
      const behind = Math.floor(-1 + u * (rows + p.tail + 1)) - led.y;
      if (behind > 0) passed = true;
      if (behind === 0) lit = 1;
      else if (behind > 0 && behind <= p.tail) {
        // The tail fades from the head and churns like a column of changing glyphs.
        const flick = hash(led.x, led.y, Math.floor(phase * p.churn)) < BRIGHT ? 1 : 0.3;
        lit = Math.max(lit, (1 - behind / (p.tail + 1)) * flick);
      }
    }
    return { lit: Math.max(lit, shown(led, passed) || 0) };
  };
}

/** Streams of falling dots down every column, each leaving the message lit where it passed. */
export const rainIn = move({
  name: 'rain-in',
  about: 'Streams of dots fall down every column, leaving the message behind them.',
  slot: 'enter',
  params: RAIN_PARAMS,
  patch(at, p) {
    const draw = rain(at, p, (led, passed) => passed && litAt(at, led));
    return patch<Led, Pose>(p.ms, draw, { writes: ['lit'] });
  },
  shader: (at, p) => rainShader(at, p, false),
});

/** Streams of falling dots down every column, each washing the message away as it passes. */
export const rainOut = move({
  name: 'rain-out',
  about: 'Streams of dots fall down every column, washing the message away.',
  slot: 'exit',
  params: RAIN_PARAMS,
  patch(at, p) {
    const draw = rain(at, p, (led, passed) => !passed && litAt(at, led));
    return patch<Led, Pose>(p.ms, draw, { writes: ['lit'] });
  },
  shader: (at, p) => rainShader(at, p, true),
});
