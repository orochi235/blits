import { patch } from '@msb235/blits';
import type { Led, Pose } from '../board.js';
import type { Placed } from '../orders.js';
import { move } from './move.js';
import { type Lookup, moveShader } from './shader.js';

/** The tiled rows' geometry: one copy's length, the rows' pitch, the tilt, and the board's center. */
function layout(at: Placed, p: { angle: number; gap: number; leading: number }) {
  const { board: b, text } = at;
  const a = (p.angle * Math.PI) / 180;
  return {
    period: text.cols + p.gap,
    pitch: text.rows + p.leading,
    c: Math.cos(a),
    s: Math.sin(a),
    cx: b.cols / 2,
    cy: b.rows / 2,
  };
}

/** The tiled message, as tile draws it, reading the text from `bitmap`. */
const TILE = moveShader({
  params: ['period', 'pitch', 'c', 's', 'cx', 'cy', 'brick', 'textRows'],
  wgsl: `if (params.period > 0.0) {
  let dx = subject.x - params.cx;
  let dy = subject.y - params.cy;
  let along = dx * params.c - dy * params.s;
  let across = dx * params.s + dy * params.c;
  let r = floor(across / params.pitch);
  let y = floor(across - r * params.pitch);
  if (y < params.textRows) {
    let moved = phase * params.period;
    let col = floor(along + select(moved, params.brick * params.period - moved, r % 2.0 != 0.0));
    lit = table_bitmap(col - params.period * floor(col / params.period), y);
  }
}`,
  at(phase, d, p, t) {
    const n = (k: string) => p[k] as number;
    const [period, pitch, c, s, brick] = [n('period'), n('pitch'), n('c'), n('s'), n('brick')];
    if (period <= 0) return 0;
    const [dx, dy] = [d.x - n('cx'), d.y - n('cy')];
    const along = dx * c - dy * s;
    const across = dx * s + dy * c;
    const r = Math.floor(across / pitch);
    const y = Math.floor(across - r * pitch);
    if (y >= n('textRows')) return 0;
    const moved = phase * period;
    const col = Math.floor(along + (r % 2 !== 0 ? brick * period - moved : moved));
    const x = ((col % period) + period) % period;
    return (t.bitmap as Lookup)(x, y);
  },
});

/** The message repeated over the whole sign in tilted brick rows, neighbors scrolling opposite ways; one pass is one period, so it loops without a seam. */
export const tile = move({
  name: 'tile',
  about: 'Repeats the message in tilted brick rows, neighbors scrolling opposite ways.',
  slot: 'active',
  wide: true,
  params: {
    angle: {
      label: 'tilt',
      min: -60,
      max: 60,
      step: 1,
      value: 30,
      unit: '°',
      about:
        'How steeply the rows of text slant. At 0 they run level; negative slants the other way.',
    },
    step: {
      label: 'column time',
      min: 10,
      max: 300,
      step: 5,
      value: 60,
      unit: 'ms',
      about: 'How long the rows wait before moving one column. Higher scrolls more slowly.',
    },
    gap: {
      label: 'gap',
      min: 0,
      max: 30,
      step: 1,
      value: 6,
      unit: 'cols',
      about: 'How many blank columns separate each copy of the message from the next along a row.',
    },
    leading: {
      label: 'row gap',
      min: 1,
      max: 6,
      step: 1,
      value: 2,
      unit: 'rows',
      about: 'How many blank rows separate one row of text from the next.',
    },
    brick: {
      label: 'brick offset',
      min: 0,
      max: 1,
      step: 0.05,
      value: 0.5,
      about:
        'How far every other row is shifted along, as a share of one copy, like courses of bricks. At 0 the copies line up in columns.',
    },
  },
  patch(at, p) {
    const { text } = at;
    const { period, pitch, c, s, cx, cy } = layout(at, p);
    const ms = Math.max(1, period) * p.step;
    return patch<Led, Pose>(
      ms,
      (phase, led) => {
        if (period <= 0) return { lit: 0 };
        const dx = led.x - cx;
        const dy = led.y - cy;
        // Along the rows rises to the right; across them points down the sign.
        const along = dx * c - dy * s;
        const across = dx * s + dy * c;
        const r = Math.floor(across / pitch);
        const y = Math.floor(across - r * pitch);
        if (y >= text.rows) return { lit: 0 };
        const odd = r % 2 !== 0;
        const moved = phase * period;
        const col = Math.floor(along + (odd ? p.brick * period - moved : moved));
        const x = ((col % period) + period) % period;
        return { lit: text.level(x, y) };
      },
      { writes: ['lit'] },
    );
  },
  shader(at, p) {
    const l = layout(at, p);
    return TILE(at, Math.max(1, l.period) * p.step, {
      ...l,
      brick: p.brick,
      textRows: at.text.rows,
    });
  },
});
