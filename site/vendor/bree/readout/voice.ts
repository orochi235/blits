import type { Board } from '../board.js';
import { type Bound, kernels, type ModShader, type Tables } from '../modulators/shader.js';

const bind = kernels({
  params: [],
  wgsl: `out.lit = table_on(subject.x, subject.y);
let k = subject.x * 4.0;
out.tint = array<f32, 4>(table_tint(k, subject.y), table_tint(k + 1.0, subject.y), table_tint(k + 2.0, subject.y), table_tint(k + 3.0, subject.y));`,
  at: (_phase, s, v: Bound) => {
    const t = v as unknown as Tables;
    if (s.kind === 'cell') return { lit: 0, tint: [0, 0, 0, 0] };
    const on = t.on as (x: number, y: number) => number;
    const tint = t.tint as (x: number, y: number) => number;
    return { lit: on(s.x, s.y), tint: [0, 1, 2, 3].map((a) => tint(s.x * 4 + a, s.y)) };
  },
  writes: ['lit', 'tint'],
});

/**
 * The readouts' values as one looping shader patch over `b`'s dots: `on` holds how lit each dot
 * is, row by row, and `tint` its tint, four numbers a dot.
 */
export function valueVoice(b: Board, on: Float32Array, tint: Float32Array): ModShader {
  return bind(
    1000,
    {
      on: { width: b.cols, height: b.rows },
      tint: { width: b.cols * 4, height: b.rows },
    },
    { on, tint },
  );
}
