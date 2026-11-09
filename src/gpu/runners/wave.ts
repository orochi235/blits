import { wavePlanOf } from '../../wave.js';
import { cachedRunner, type Packed, type Runner } from '../runner.js';

const SHAPES = { sine: 0, triangle: 1, saw: 2, square: 3 };

/** `waveAt` in `wave.ts`, with the shape as its index in `SHAPES`. */
const HELPERS = `fn blits_wave_at(shape: f32, x: f32) -> f32 {
  let u = x - floor(x);
  if (shape == 0.0) { return sin(6.2831853 * u); }
  if (shape == 1.0) { return select(select(4.0 * u - 4.0, 2.0 - 4.0 * u, u < 0.75), 4.0 * u, u < 0.25); }
  if (shape == 2.0) { return select(2.0 * u - 2.0, 2.0 * u, u < 0.5); }
  return select(-1.0, 1.0, u < 0.5);
}`;

/** One runner per set of channels written, since the kernel needs each output's name. */
function runnerFor(writes: readonly string[]): Runner {
  return cachedRunner(`wave:${writes.join(',')}`, () => ({
    helpers: HELPERS,
    wgsl: [
      'let unit = blits_wave_at(values[base], phase * values[base + 1u] + values[base + 2u]);',
      ...writes.map(
        (n, k) => `out.${n} = values[base + ${4 + 2 * k}u] + values[base + ${3 + 2 * k}u] * unit;`,
      ),
    ].join(' '),
    writes,
    fields: [],
  }));
}

/** A `wave` patch's runner and numbers: shape, cycles, start, then each channel's depth and rest. */
export function wavePack(patch: object): Packed | undefined {
  const plan = wavePlanOf(patch);
  if (plan === undefined) return undefined;
  return {
    runner: runnerFor(plan.writes),
    values: Float32Array.from([
      SHAPES[plan.shape],
      plan.cycles,
      plan.start,
      ...plan.writes.flatMap((_, k) => [plan.depths[k] as number, plan.rests[k] as number]),
    ]),
  };
}
