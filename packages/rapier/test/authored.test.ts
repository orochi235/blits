import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';

await R2.init();
const at = (f: number) => 1000 + (f * 1000) / 60;

/** A ball held at `[4, 0]` by a 500 ms authored voice for `upto` frames, then sought back into the hold if `seek`. */
function run(seek: boolean, upto = 60) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    history: { ms: 10_000, every: 250, tape },
  });
  const ball = sim.body(
    R2.RigidBodyDesc.dynamic().setTranslation(0, 10),
    R2.ColliderDesc.ball(0.5),
  );
  sim.sync(at(0));
  ball.simulated.weight = 0;
  ball.cue({
    patch: patch<object, Pose2>(500, () => ({ position: [4, 0] }), { writes: ['position'] }),
    role: sim.role,
  });
  for (let f = 1; f <= upto; f++) sim.sync(at(f));
  let host = upto;
  if (seek) {
    sim.mix.seek(1250);
    for (let f = 1; f <= 45; f++) sim.sync(at(++host));
  }
  const t = sim.world()?.getRigidBody(0).translation();
  return { now: sim.mix.now, x: t?.x, y: t?.y };
}

it('replays an authored hold whose voices had finished before a seek back into it', () => {
  expect(run(true)).toEqual(run(false));
});

it('replays an authored hold sought back while its voice still plays', () => {
  const a = run(false);
  const b = run(true, 24);
  expect({ y: b.y, now: b.now }).toEqual({ y: a.y, now: a.now });
});
