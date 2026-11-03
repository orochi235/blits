import R2 from '@dimforge/rapier2d-compat';
import R3 from '@dimforge/rapier3d-compat';
import { keys, kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import {
  channels2,
  channels3,
  type Kinematic2,
  type Kinematic3,
  kinematic2,
  kinematic3,
  type Pose2,
  type Pose3,
  physics,
} from '../src/index.js';
import { at } from './scenes.js';

type K2 = Pose2 & Kinematic2;
type K3 = Pose3 & Kinematic3;

const make2 = () =>
  physics<K2>(kit<K2>({ ...channels2, ...kinematic2 }), {
    rapier: R2,
    gravity: [0, 0],
    history: { ms: 10_000, every: 250, tape },
  });
const hold = <O>(delta: Partial<O>) =>
  patch<object, O>(0, () => delta, { writes: Object.keys(delta) as (keyof O)[] });
const pose2 = (sim: ReturnType<typeof make2>, b: object) => sim.mix.probe(b) as K2;

it('moves a kinematic body to the goal and facing a voice on its controls writes', () => {
  const sim = make2();
  const box = sim.body(R2.RigidBodyDesc.kinematicPositionBased(), R2.ColliderDesc.cuboid(0.5, 0.5));
  box.drive({ patch: hold<K2>({ goal: [2, 1], facing: 0.5 }) });
  for (let f = 0; f <= 5; f++) sim.sync(at(f));
  const p = pose2(sim, box);
  expect(p.position[0]).toBeCloseTo(2, 5);
  expect(p.position[1]).toBeCloseTo(1, 5);
  expect(p.rotation).toBeCloseTo(0.5, 5);
});

it('leaves a kinematic body no voice writes where it is, beside one that is driven', () => {
  const sim = make2();
  const driven = sim.body(
    R2.RigidBodyDesc.kinematicPositionBased(),
    R2.ColliderDesc.cuboid(0.5, 0.5),
  );
  const still = sim.body(
    R2.RigidBodyDesc.kinematicPositionBased().setTranslation(3, 4).setRotation(0.25),
    R2.ColliderDesc.cuboid(0.5, 0.5),
  );
  driven.drive({ patch: hold<K2>({ goal: [-2, 0] }) });
  // Driven too, by a force only: its controls are probed, and its goal is still unwritten.
  still.drive({ patch: hold<K2>({ force: [1, 0] }) });
  for (let f = 0; f <= 30; f++) sim.sync(at(f));
  const p = pose2(sim, still);
  expect(p.position).toEqual([3, 4]);
  expect(p.rotation).toBeCloseTo(0.25, 6);
  expect(pose2(sim, driven).position[0]).toBeCloseTo(-2, 5);
});

it('keeps a kinematic body where its goal left it once the voice ends', () => {
  const sim = make2();
  const box = sim.body(R2.RigidBodyDesc.kinematicPositionBased(), R2.ColliderDesc.cuboid(0.5, 0.5));
  sim.sync(at(0));
  box.drive({
    patch: keys<object, K2>(500, [
      { at: 0, delta: { goal: [0, 0] } },
      { at: 1, delta: { goal: [1, 0] } },
    ]),
    loop: false,
  });
  for (let f = 0; f <= 60; f++) sim.sync(at(f));
  const x = pose2(sim, box).position[0] as number;
  expect(x).toBeGreaterThan(0.9);
  for (let f = 61; f <= 90; f++) sim.sync(at(f));
  expect(pose2(sim, box).position[0]).toBe(x);
});

it('pushes a dynamic body out of a moving kinematic body’s way', () => {
  const sim = make2();
  const paddle = sim.body(
    R2.RigidBodyDesc.kinematicPositionBased().setTranslation(-2, 0),
    R2.ColliderDesc.cuboid(0.25, 1),
  );
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5).setMass(1));
  sim.sync(at(0));
  paddle.drive({
    patch: keys<object, K2>(1000, [
      { at: 0, delta: { goal: [-2, 0] } },
      { at: 1, delta: { goal: [1, 0] } },
    ]),
    loop: false,
  });
  for (let f = 0; f <= 60; f++) sim.sync(at(f));
  expect(pose2(sim, ball).position[0]).toBeGreaterThan(1);
});

it('replays a kinematic body’s goals on a seek back', () => {
  const run = () => {
    const sim = make2();
    const paddle = sim.body(
      R2.RigidBodyDesc.kinematicPositionBased().setTranslation(-2, 0),
      R2.ColliderDesc.cuboid(0.25, 1),
    );
    const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5).setMass(1));
    sim.sync(at(0));
    paddle.drive({
      patch: keys<object, K2>(1000, [
        { at: 0, delta: { goal: [-2, 0], facing: 0 } },
        { at: 1, delta: { goal: [1, 0], facing: 1 } },
      ]),
      loop: false,
    });
    return { sim, ball };
  };
  const straight = run();
  const want: number[][] = [];
  for (let f = 0; f <= 90; f++) {
    straight.sim.sync(at(f));
    want.push([...pose2(straight.sim, straight.ball).position]);
  }
  const sought = run();
  for (let f = 0; f <= 90; f++) sought.sim.sync(at(f));
  sought.sim.mix.seek(at(10));
  const shift = at(90) - at(10);
  const got: number[][] = [];
  for (let f = 11; f <= 90; f++) {
    sought.sim.sync(at(f) + shift);
    got.push([...pose2(sought.sim, sought.ball).position]);
  }
  expect(got).toEqual(want.slice(11));
});

it('turns a 3D kinematic body to a quaternion facing', () => {
  const sim = physics<K3>(kit<K3>({ ...channels3, ...kinematic3 }), {
    rapier: R3,
    gravity: [0, 0, 0],
  });
  const box = sim.body(
    R3.RigidBodyDesc.kinematicPositionBased(),
    R3.ColliderDesc.cuboid(0.5, 0.5, 0.5),
  );
  const s = Math.SQRT1_2;
  box.drive({ patch: hold<K3>({ goal: [1, 2, 3], facing: [0, s, 0, s] }) });
  for (let f = 0; f <= 5; f++) sim.sync(at(f));
  const p = sim.mix.probe(box) as K3;
  p.position.forEach((x, i) => {
    expect(x).toBeCloseTo([1, 2, 3][i] as number, 5);
  });
  p.rotation.forEach((x, i) => {
    expect(x).toBeCloseTo([0, s, 0, s][i] as number, 5);
  });
});
