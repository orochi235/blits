import R2 from '@dimforge/rapier2d-compat';
import { kit, level, patch, type Signal, share } from '@msb235/blits';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

/** A body that falls freely, read at frame 30. */
function falling(weight?: Signal<object>) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    ...(weight === undefined ? {} : { weight }),
  });
  const ball = sim.body(
    R2.RigidBodyDesc.dynamic().setTranslation(0, 10),
    R2.ColliderDesc.ball(0.5),
  );
  const read = () => {
    for (let f = 0; f <= 30; f++) sim.sync(at(f));
    return (sim.mix.probe(ball) as Pose2).position;
  };
  return { sim, ball, read };
}

const hold = (position: [number, number]) =>
  patch<object, Pose2>(0, () => ({ position }), { writes: ['position'] });

it("shows the world's pose through the simulated voice", () => {
  const { sim, ball, read } = falling();
  const [x, y] = read();
  expect(sim.world()).toBeDefined();
  expect(x).toBeCloseTo(0, 6);
  expect(y).toBeLessThan(10);
  expect(y).toBeGreaterThan(5);
  expect(ball.simulated.weight).toBe(1);
});

it("crossfades with an authored voice in the simulation's role", () => {
  const free = falling().read();
  const { sim, ball, read } = falling();
  ball.cue({ patch: hold([4, 0]), role: sim.role });
  const [x, y] = read();
  expect(x).toBeCloseTo(2, 6);
  expect(y).toBeCloseTo((free[1] as number) / 2, 6);
});

it('adds an authored voice outside the role on top of the simulation', () => {
  const free = falling().read();
  const { ball, read } = falling();
  ball.cue({ patch: hold([4, 1]) });
  const [x, y] = read();
  expect(x).toBeCloseTo(4, 6);
  expect(y).toBeCloseTo((free[1] as number) + 1, 6);
});

it('shows only the authored voice once the simulated one is faded out', () => {
  const { sim, ball, read } = falling();
  ball.cue({ patch: hold([4, 0]), role: sim.role });
  ball.simulated.weight = 0;
  expect(read()).toEqual([4, 0]);
});

it('hands a body to an authored voice by a weight signal, and back from where it was shown', () => {
  const k = level<object>(0);
  const { sim, ball, read } = falling(share(k, 0, 2));
  ball.cue({ patch: hold([4, 0]), weight: share(k, 1, 2), role: sim.role });
  const free = read();
  expect(free[0]).toBeCloseTo(0, 6);
  k.set(1);
  for (let f = 31; f <= 40; f++) sim.sync(at(f));
  expect((sim.mix.probe(ball) as Pose2).position).toEqual([4, 0]);
  k.set(0);
  sim.sync(at(41));
  const back = (sim.mix.probe(ball) as Pose2).position;
  expect(back[0]).toBeCloseTo(4, 6);
  expect(back[1]).toBeLessThan(0);
  expect(back[1]).toBeGreaterThan(-0.1);
});

it('carries the speed of an authored voice into the simulation it hands back to', () => {
  const k = level<object>(1);
  const { sim, ball } = falling(share(k, 0, 2));
  const slide = patch<object, Pose2>(10_000, (u) => ({ position: [u * 60, 0] }), {
    writes: ['position'],
  });
  ball.cue({ patch: slide, weight: share(k, 1, 2), role: sim.role });
  for (let f = 0; f <= 30; f++) sim.sync(at(f));
  k.set(0);
  sim.sync(at(31));
  const a = (sim.mix.probe(ball) as Pose2).position[0] as number;
  for (let f = 32; f <= 41; f++) sim.sync(at(f));
  const b = (sim.mix.probe(ball) as Pose2).position[0] as number;
  // The slide's 6 a second, kept for the ten frames after.
  expect((b - a) / (10 / 60)).toBeCloseTo(6, 1);
});
