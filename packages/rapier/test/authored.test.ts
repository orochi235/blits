import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';

await R2.init();
const at = (f: number) => 1000 + (f * 1000) / 60;

/** Where the world has the ball and how fast it goes. */
function state(sim: ReturnType<typeof physics<Pose2>>) {
  const b = (sim.world() as unknown as R2.World).getRigidBody(0);
  const [t, v] = [b.translation(), b.linvel()];
  return { x: t.x, y: t.y, r: b.rotation(), vx: v.x, vy: v.y, vr: b.angvel() };
}

/** A ball held by a 500 ms authored voice at `[4, 0]` for `upto` frames, sought back to 1250 ms if `seek`. */
function still(seek: boolean, upto = 60) {
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
  return { now: sim.mix.now, ...state(sim) };
}

it('replays an authored hold whose voices had finished before a seek back into it', () => {
  expect(still(true)).toEqual(still(false));
});

it('replays an authored hold sought back while its voice still plays', () => {
  expect(still(true, 24)).toEqual(still(false));
});

/**
 * With no gravity, a ball carried from x 0 to 2 every 480 ms by an authored voice in the role and
 * let go at frame 61; given `back`, played to frame 90, sought back to frame `back` and played on.
 * Each frame from `back` on, as the world has the ball.
 */
function carried(back?: number) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    gravity: [0, 0],
    history: { ms: 10_000, every: 250, tape },
  });
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5));
  let shift = 0;
  const frame = (f: number) => {
    sim.sync(at(f) + shift);
    return state(sim);
  };
  const out = [];
  for (let f = 0; f <= 90; f++) {
    out.push(frame(f));
    if (f === 0) {
      ball.simulated.weight = 0;
      ball.cue({
        patch: patch<object, Pose2>(480, (u) => ({ position: [u * 2, 0] }), {
          writes: ['position'],
        }),
        role: sim.role,
        loop: true,
      });
    }
    if (f === 60) ball.simulated.weight = 1;
  }
  if (back === undefined) return out;
  sim.mix.seek(at(back));
  shift += at(90) - at(back);
  const replayed = [];
  for (let f = back + 1; f <= 90; f++) replayed.push(frame(f));
  return replayed;
}

it('carries the speed of a hold sought back into through every frame of the replay', () => {
  const want = carried();
  expect(want[90]?.vx).toBeGreaterThan(0);
  expect(carried(28)).toEqual(want.slice(29));
});
