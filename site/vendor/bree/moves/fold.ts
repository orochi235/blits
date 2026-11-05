import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import { rasterize } from '../font.js';
import type { Placed } from '../orders.js';
import { move } from './move.js';
import { type Lookup, moveShader } from './shader.js';

const QUARTER = Math.PI / 2;
const FOLD_PARAM = {
  label: 'fold time',
  min: 50,
  max: 1000,
  step: 10,
  value: 300,
  unit: 'ms',
  about: 'How long the letters take to turn between flat and edge on. Higher turns more slowly.',
};

/**
 * The angle unfold (`mode` 0), fold (1) or tumble (2) turns the letters through at `phase`; tumble
 * turns only in the middle third, upright either side.
 */
function angleOf(mode: number, turns: number, phase: number) {
  if (mode === 0) return QUARTER * (1 - phase);
  if (mode === 1) return QUARTER * phase;
  const u = 3 * phase - 1;
  return u > 0 && u < 1 ? 2 * Math.PI * turns * u : 0;
}

/**
 * `turned`, reading the top row of the line each text row is on from `tops` (-1 for none), and
 * whether a column of the line starting at a row has any lit dot from `any`.
 */
const TURNED = moveShader({
  params: ['left', 'tall', 'mode', 'turns'],
  wgsl: `let u = 3.0 * phase - 1.0;
var angle = select(${QUARTER} * phase, ${QUARTER} * (1.0 - phase), params.mode < 0.5);
if (params.mode > 1.5) { angle = select(0.0, 6.283185307179586 * params.turns * u, u > 0.0 && u < 1.0); }
let top = select(-1.0, table_tops(0.0, row), row >= 0.0);
let x = subject.x - params.left;
if (top >= 0.0 && !(params.mode > 0.5 && params.mode < 1.5 && phase >= 1.0)) {
  let mid = top + (params.tall - 1.0) * 0.5;
  let s = cos(angle);
  if (abs(s) < 0.18) {
    lit = select(0.0, 1.0, row == mid && table_any(x, top) > 0.0);
  } else {
    let src = floor(mid + (row - mid) / s + 0.5);
    lit = select(0.0, table_bitmap(x, src), src >= top && src < top + params.tall);
  }
}`,
  at(phase, d, p, tables) {
    const t = tables as Record<'bitmap' | 'rows' | 'tops' | 'any', Lookup>;
    const [mode, tall] = [p.mode as number, p.tall as number];
    if (mode === 1 && phase >= 1) return 0;
    const row = t.rows(0, d.y) - 1;
    const top = row < 0 ? -1 : t.tops(0, row);
    if (top < 0) return 0;
    const x = d.x - (p.left as number);
    const mid = top + (tall - 1) / 2;
    const s = Math.cos(angleOf(mode, p.turns as number, phase));
    if (Math.abs(s) < 0.18) return row === mid && t.any(x, top) > 0 ? 1 : 0;
    const from = Math.round(mid + (row - mid) / s);
    return from >= top && from < top + tall ? t.bitmap(x, from) : 0;
  },
});

/**
 * Draws a letter turned `angle` radians about the horizontal middle of its line; edge on it is a
 * line.
 */
function turned(at: Placed) {
  const { text } = at;
  const tall = rasterize('', text).rows;
  const tops = [...new Set(text.letters.map((l) => l.y))];
  /** The top row of the line `row` is on, the last line holding it where lines' ghost rows meet. */
  const topOf = (row: number) => {
    let top: number | undefined;
    for (const t of tops) if (row >= t && row < t + tall) top = t;
    return top;
  };
  const any = tops.map((t) =>
    Array.from({ length: text.cols }, (_, x) =>
      Array.from({ length: tall }, (_, y) => text.lit(x, t + y)).some(Boolean),
    ),
  );
  /** The letters turning as unfold (`mode` 0), fold (1) or tumble (2) turns them, as a shader. */
  const shader = (ms: number, mode: number, turns = 0) => {
    const width = Math.max(1, text.cols);
    const height = Math.max(1, text.rows);
    const topRows = Array.from({ length: height }, (_, row) => topOf(row) ?? -1);
    const anyAt = new Float32Array(width * height);
    tops.forEach((top, k) => {
      any[k]?.forEach((v, x) => {
        if (v && top < height) anyAt[top * width + x] = 1;
      });
    });
    return TURNED(
      at,
      ms,
      { left: at.left, tall, mode, turns },
      {
        tops: { width: 1, height, data: topRows },
        any: { width, height, data: anyAt },
      },
    );
  };
  const draw = (led: Led, angle: number) => {
    const row = at.rowOf(led);
    const x = led.x - at.left;
    const top = row < 0 ? undefined : topOf(row);
    if (top === undefined) return { lit: 0 };
    const mid = top + (tall - 1) / 2;
    const s = Math.cos(angle);
    if (Math.abs(s) < 0.18) return { lit: row === mid && any[tops.indexOf(top)]?.[x] ? 1 : 0 };
    const from = Math.round(mid + (row - mid) / s);
    return { lit: from >= top && from < top + tall ? text.level(x, from) : 0 };
  };
  return { draw, shader };
}

/** Letters open from edge on to flat. */
export const unfold = move({
  name: 'unfold',
  about: 'Letters unfold from edge on to flat.',
  slot: 'enter',
  params: { ms: FOLD_PARAM },
  patch(at, p) {
    const { draw } = turned(at);
    return patch<Led, Pose>(p.ms, (phase, led) => draw(led, angleOf(0, 0, phase)), {
      writes: ['lit'],
    });
  },
  shader: (at, p) => turned(at).shader(p.ms, 0),
});

/** Letters close from flat to edge on and vanish. */
export const fold = move({
  name: 'fold',
  about: 'Letters fold from flat to edge on and vanish.',
  slot: 'exit',
  params: { ms: FOLD_PARAM },
  patch(at, p) {
    const { draw } = turned(at);
    return patch<Led, Pose>(
      p.ms,
      (phase, led) => (phase >= 1 ? { lit: 0 } : draw(led, angleOf(1, 0, phase))),
      {
        writes: ['lit'],
      },
    );
  },
  shader: (at, p) => turned(at).shader(p.ms, 1),
});

/** Letters turn end over end in the middle third of the pass, standing upright either side. */
export const tumble = move({
  name: 'tumble',
  about: 'Letters stand, turn end over end, and stand again.',
  slot: 'active',
  params: {
    ms: {
      label: 'length',
      min: 200,
      max: 10000,
      step: 100,
      value: 1200,
      unit: 'ms',
      about:
        'How long one pass lasts. The letters tumble in its middle third and stand still either side.',
    },
    turns: {
      label: 'turns',
      min: 0,
      max: 6,
      step: 1,
      value: 2,
      about: 'How many times each letter turns end over end. At 0 they stand still.',
    },
  },
  patch(at, p) {
    const { draw } = turned(at);
    return patch<Led, Pose>(p.ms, (phase, led) => draw(led, angleOf(2, p.turns, phase)), {
      writes: ['lit'],
    });
  },
  shader: (at, p) => turned(at).shader(p.ms, 2, p.turns),
});
