import { mixHex, oklab, patch } from '@msb235/blits';
import type { Pose, Subject } from '../board.js';
import type { Placed } from '../orders.js';
import type { ColorsParam } from '../params.js';
import { modulator, outweigh } from './modulator.js';
import { recent, shader } from './shader.js';

/** A ramp's tints across `at`'s board, one a column or row, outweighing the scene's. */
function rampOf(at: Placed, p: { colors: readonly number[]; direction: string }) {
  const stops = p.colors.length ? p.colors : [0xffffff];
  const down = p.direction === 'down';
  const span = Math.max(1, (down ? at.board.rows : at.board.cols) - 1);
  const tints = Array.from({ length: span + 1 }, (_, j) => {
    const x = (j / span) * (stops.length - 1);
    const i = Math.min(Math.max(0, stops.length - 2), Math.floor(x));
    const a = stops[i] as number;
    return outweigh(oklab(mixHex(a, stops[i + 1] ?? a, x - i)));
  });
  return { down, span, tints };
}

/** The column or row of the ramp a dot shows. */
const jOf = (s: { x: number; y: number }, down: boolean, span: number) =>
  Math.min(span, Math.max(0, Math.round(down ? s.y : s.x)));

/** One shader per ramp length, since a table's size is the shader's; the newest few are kept. */
const shaders = recent<number, ReturnType<typeof shader>>(8);
const shaderOf = (span: number) =>
  shaders(span, () =>
    shader({
      params: ['down', 'span'],
      tables: { tints: { width: 4, height: span + 1 } },
      wgsl: `let j = clamp(floor(select(subject.x, subject.y, params.down > 0.5) + 0.5), 0.0, params.span);
out.tint = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
if (subject.cell < 0.5) {
  out.tint = array<f32, 4>(table_tints(0.0, j), table_tints(1.0, j), table_tints(2.0, j), table_tints(3.0, j));
}`,
      at: (_ph, s, p, t) => {
        if (s.kind === 'cell') return { tint: [0, 0, 0, 0] };
        const j = jOf(s, (p.down as number) > 0.5, p.span as number);
        return {
          tint: [0, 1, 2, 3].map((a) => (t.tints as (x: number, y: number) => number)(a, j)),
        };
      },
      writes: ['tint'],
    }),
  );

/**
 * A still ramp of tint through its colors, left to right or top to bottom, each pair blended
 * round the hue so the middle never passes through gray. Ignores the order.
 */
export const gradient = modulator({
  name: 'gradient',
  about: 'A still blend of colors across the sign, from one edge to the other.',
  params: {
    colors: {
      label: 'colors',
      colors: [0xff2d6f, 0xffb31a],
      about:
        'The colors the ramp runs through, first to last. Two blend edge to edge; add swatches for more stops.',
    } as ColorsParam,
    direction: {
      label: 'direction',
      choices: ['across', 'down'],
      value: 'across',
      about:
        'Across runs the colors from the left edge to the right; down runs them from the top row to the bottom.',
    },
  },
  writes: ['tint'],
  on: 'dots',
  patch: (at, p) => {
    const { down, span, tints } = rampOf(at, p);
    return patch<Subject, Pose>(
      1000,
      (_phase, s) => (s.kind === 'cell' ? {} : { tint: tints[jOf(s, down, span)] as number[] }),
      { writes: ['tint'] },
    );
  },
  shader: (at, p) => {
    const { down, span, tints } = rampOf(at, p);
    return shaderOf(span)(1000, { down: down ? 1 : 0, span, tints: tints.flat() });
  },
});
