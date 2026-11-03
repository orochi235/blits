import R2 from '@dimforge/rapier2d-compat';
import R3 from '@dimforge/rapier3d-compat';
import { kit, patch } from '@msb235/blits';
import { expect, it } from 'vitest';
import { channels2, channels3, type Pose2, type Pose3, physics } from '../src/index.js';
import { at } from './scenes.js';

/** A 1 kg body with gravity off, read at frame 60, with `drive` applied to its controls first. */
function float(
  drive?: (sim: ReturnType<typeof make>, ball: ReturnType<ReturnType<typeof make>['body']>) => void,
) {
  const sim = make();
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5).setMass(1));
  drive?.(sim, ball);
  for (let f = 0; f <= 60; f++) sim.sync(at(f));
  return sim.mix.probe(ball) as Pose2;
}
const make = () => physics<Pose2>(kit<Pose2>(channels2), { rapier: R2, gravity: [0, 0] });
const push = (delta: Partial<Pose2>) =>
  patch<object, Pose2>(0, () => delta, { writes: Object.keys(delta) as (keyof Pose2)[] });

it('moves a body by a force on its controls, scaled by the voice weight', () => {
  const full = float((_s, b) => b.drive({ patch: push({ force: [2, 0] }) }));
  const half = float((_s, b) => b.drive({ patch: push({ force: [2, 0] }), weight: 0.5 }));
  expect(full.position[0]).toBeGreaterThan(0.5);
  expect(half.position[0]).toBeCloseTo(full.position[0] / 2, 4);
  expect(full.position[1]).toBeCloseTo(0, 6);
});

it('spins a body by a torque on its controls', () => {
  const spun = float((_s, b) => b.drive({ patch: push({ torque: 0.5 }) }));
  expect(Math.abs(spun.rotation)).toBeGreaterThan(0.1);
});

it('moves a body by one impulse, once', () => {
  const sim = make();
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5).setMass(1));
  sim.sync(at(0));
  ball.impulse([1, 0]);
  const x = (f: number) => {
    sim.sync(at(f));
    return (sim.mix.probe(ball) as Pose2).position[0];
  };
  const a = x(30);
  const b = x(60);
  // Constant speed after one kick: the second half covers what the first did.
  expect(a).toBeGreaterThan(0.2);
  expect(b - a).toBeCloseTo(a, 2);
});

it('pushes a 3D body by force and torque', () => {
  const sim = physics<Pose3>(kit<Pose3>(channels3), { rapier: R3, gravity: [0, 0, 0] });
  const ball = sim.body(R3.RigidBodyDesc.dynamic(), R3.ColliderDesc.ball(0.5).setMass(1));
  ball.drive({
    patch: patch<object, Pose3>(0, () => ({ force: [0, 0, 2], torque: [0, 0.5, 0] }), {
      writes: ['force', 'torque'],
    }),
  });
  for (let f = 0; f <= 60; f++) sim.sync(at(f));
  const p = sim.mix.probe(ball) as Pose3;
  expect(p.position[2]).toBeGreaterThan(0.5);
  expect(Math.abs(p.rotation[1])).toBeGreaterThan(0.05);
});

it('turns a 2D rotation the short way round in radians', () => {
  expect(channels2.rotation.lerp(3, -3, 0.5)).toBeCloseTo(Math.PI, 6);
});
