import { patch } from '@msb235/blits';
import { MeshBasicMaterial } from 'three';
import {
  ConstantColor,
  ConstantValue,
  IntervalValue,
  type Particle,
  ParticleSystem,
  PointEmitter,
  RenderMode,
  Vector4,
} from 'three.quarks';
import type { Emission } from '../src/index.js';

export interface Spot {
  id: string;
}

type Parameters = ConstructorParameters<typeof ParticleSystem>[0];

/** A system authored as speed 5, life 2, size 0.1..0.2 and color (1, 0.5, 0.25, 1). */
export function system(over: Partial<Parameters> = {}): ParticleSystem {
  return new ParticleSystem({
    looping: true,
    duration: 1,
    onlyUsedByOther: true,
    worldSpace: true,
    shape: new PointEmitter(),
    startLife: new ConstantValue(2),
    startSpeed: new ConstantValue(5),
    startSize: new IntervalValue(0.1, 0.2),
    startColor: new ConstantColor(new Vector4(1, 0.5, 0.25, 1)),
    emissionOverTime: new ConstantValue(0),
    renderMode: RenderMode.BillBoard,
    material: new MeshBasicMaterial(),
    ...over,
  });
}

/** Every particle the system holds, oldest first. */
export function born(s: ParticleSystem): Particle[] {
  return Array.from({ length: s.particleNum }, (_, i) => s.particles[i] as Particle);
}

/** A voice that holds these fields at a constant value. */
export function hold(d: Partial<Emission>) {
  return patch<Spot, Emission>(0, () => d, { writes: Object.keys(d) as (keyof Emission)[] });
}
