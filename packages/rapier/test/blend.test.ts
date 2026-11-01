import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

/** A body that falls freely, read at frame 30. */
function falling() {
  const sim = physics<Pose2>(kit<Pose2>(channels2), { rapier: R2 });
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
