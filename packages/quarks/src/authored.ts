import { ConstantColor, ConstantValue, IntervalValue, type ParticleSystem } from 'three.quarks';
import type { Emission } from './channels.js';

type Scalar = 'speed' | 'size' | 'life';

const FIELD = { speed: 'startSpeed', size: 'startSize', life: 'startLife' } as const;
const SCALARS = ['speed', 'size', 'life'] as const;

type Range = { gen: ConstantValue; value: number } | { gen: IntervalValue; a: number; b: number };

/** Which of the driver's channels a host's kit holds, and so which fields the driver writes. */
export type Applies = Readonly<Record<Scalar | 'tint', boolean>>;

/**
 * A system's start values as the host authored them, captured once so scaling never compounds:
 * written scaled for one subject before its particles are born, and put back afterwards.
 */
export class Authored {
  private readonly ranges: Partial<Record<Scalar, Range>> = {};
  private readonly tint: { gen: ConstantColor; rgba: readonly number[] } | null;

  constructor(
    readonly system: ParticleSystem,
    applies: Applies,
  ) {
    if (!system.worldSpace)
      throw new Error(
        'blits-quarks: a system needs worldSpace: true, since the driver places particles in world coordinates',
      );
    for (const [i, name] of SCALARS.entries()) {
      if (!applies[name]) continue;
      for (const [j, other] of SCALARS.entries())
        if (j !== i && system[FIELD[other]] === system[FIELD[name]])
          throw new Error(
            `blits-quarks: ${FIELD[i < j ? name : other]} and ${FIELD[i < j ? other : name]} share one generator, so scaling one would scale both; give each its own`,
          );
      const gen = system[FIELD[name]];
      if (gen instanceof ConstantValue) this.ranges[name] = { gen, value: gen.value };
      else if (gen instanceof IntervalValue) this.ranges[name] = { gen, a: gen.a, b: gen.b };
      else
        throw new Error(
          `blits-quarks: ${FIELD[name]} has to be a ConstantValue or an IntervalValue to scale`,
        );
    }
    if (!applies.tint) this.tint = null;
    else if (system.startColor instanceof ConstantColor) {
      const c = system.startColor.color;
      this.tint = { gen: system.startColor, rgba: [c.x, c.y, c.z, c.w] };
    } else throw new Error('blits-quarks: startColor has to be a ConstantColor to tint');
  }

  apply(pose: Partial<Emission>): void {
    for (const name of SCALARS) {
      const range = this.ranges[name];
      const k = pose[name];
      if (range === undefined || k === undefined) continue;
      if ('value' in range) range.gen.value = range.value * k;
      else {
        range.gen.a = range.a * k;
        range.gen.b = range.b * k;
      }
    }
    const tint = this.tint;
    const k = pose.tint;
    if (tint !== null && k !== undefined) {
      const [r, g, b, a] = tint.rgba as [number, number, number, number];
      tint.gen.color.set(r * (k[0] ?? 1), g * (k[1] ?? 1), b * (k[2] ?? 1), a * (k[3] ?? 1));
    }
  }

  restore(): void {
    for (const name of SCALARS) {
      const range = this.ranges[name];
      if (range === undefined) continue;
      if ('value' in range) range.gen.value = range.value;
      else {
        range.gen.a = range.a;
        range.gen.b = range.b;
      }
    }
    if (this.tint !== null) {
      const [r, g, b, a] = this.tint.rgba as [number, number, number, number];
      this.tint.gen.color.set(r, g, b, a);
    }
  }
}
