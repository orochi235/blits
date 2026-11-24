import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { type Body, channels2, type Physics, type Pose2, physics } from '../src/index.js';

await R2.init();

/** Frames 16 ms apart, so the world's 1000 / 60 ms steps fall between them. */
const at = (f: number) => 1000 + f * 16;

type Sim = Physics<Pose2, Record<string, never>>;
type Ball = Body<Pose2, Record<string, never>>;

const push = patch<object, Pose2>(1000, () => ({ force: [1, 0] }), { writes: ['force'] });
const still = patch<object, Pose2>(0, () => ({ position: [3, 1] }), { writes: ['position'] });
const slide = patch<object, Pose2>(400, (u) => ({ position: [u * 2, 0] }), {
  writes: ['position'],
});

/**
 * A ball in a world with no gravity, `setup` before the first frame and `call` after frame 30's
 * sync, played to frame 90; then, given `back`, sought back to frame `back` and played on to 90.
 * Each frame's full pose, shown and simulated, and speed, those after `back` where it seeks.
 */
function run(
  setup: (sim: Sim, ball: Ball) => void,
  call: (sim: Sim, ball: Ball) => void,
  back?: number,
) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    gravity: [0, 0],
    history: { ms: 10_000, every: 250, tape },
  });
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5));
  setup(sim, ball);
  let shift = 0;
  const read = (f: number) => {
    const p = sim.mix.probe(ball) as unknown as Pose2;
    const b = (sim.world() as unknown as R2.World).getRigidBody(0);
    const [w, v] = [b.translation(), b.linvel()];
    // Shown, and where the world has it, which a hold can leave apart until the hand-back.
    const shown = { x: p.position[0], y: p.position[1], r: p.rotation };
    return { f, ...shown, wx: w.x, wy: w.y, wr: b.rotation(), vx: v.x, vy: v.y, vr: b.angvel() };
  };
  const frame = (f: number) => {
    sim.sync(at(f) + shift);
    return read(f);
  };
  const out = [];
  for (let f = 0; f <= 90; f++) {
    out.push(frame(f));
    // The tape makes a call again in the sync of the frame it was made after, so that frame's
    // output is read after it, as engine's drivercheck has it.
    if (f === 30) {
      call(sim, ball);
      out[f] = read(f);
    }
  }
  if (back === undefined) return out;
  sim.mix.seek(at(back));
  shift += at(90) - at(back);
  const replayed = [];
  for (let f = back + 1; f <= 90; f++) replayed.push(frame(f));
  return replayed;
}

const none = () => {};
const cases: [string, (sim: Sim, ball: Ball) => void, (sim: Sim, ball: Ball) => void][] = [
  ['a drive', none, (_sim, ball) => void ball.drive({ patch: push })],
  [
    'a hold, cued with the simulated weight written',
    none,
    (sim, ball) => {
      ball.simulated.weight = 0;
      ball.cue({ patch: still, role: sim.role });
    },
  ],
  [
    'a hand-back from a moving hold, the simulated weight written',
    (sim, ball) => {
      ball.simulated.weight = 0;
      ball.cue({ patch: slide, role: sim.role, loop: true });
    },
    (_sim, ball) => {
      ball.simulated.weight = 1;
    },
  ],
];

for (const [name, setup, call] of cases)
  it(`replays ${name} between frames from the frame after, as it first played`, () => {
    const want = run(setup, call);
    expect(want[31]).not.toEqual(want[90]);
    expect(run(setup, call, 10)).toEqual(want.slice(11));
  });

it('plays a call the host makes after a seek back in place of the one ahead', () => {
  const make = () => {
    const sim = physics<Pose2>(kit<Pose2>(channels2), {
      rapier: R2,
      gravity: [0, 0],
      history: { ms: 10_000, every: 250, tape },
    });
    const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5));
    let shift = 0;
    return {
      ball,
      frame(f: number) {
        sim.sync(at(f) + shift);
        const b = (sim.world() as unknown as R2.World).getRigidBody(0);
        return [b.translation(), b.linvel()];
      },
      seek(from: number, to: number) {
        sim.mix.seek(at(to));
        shift += at(from) - at(to);
      },
    };
  };
  const straight = make();
  const want = [];
  for (let f = 0; f <= 90; f++) {
    want.push(straight.frame(f));
    if (f === 20) straight.ball.drive({ patch: push, weight: 2 });
  }
  const sought = make();
  for (let f = 0; f <= 90; f++) {
    sought.frame(f);
    if (f === 30) sought.ball.drive({ patch: push });
  }
  sought.seek(90, 10);
  const got = [];
  for (let f = 11; f <= 90; f++) {
    got.push(sought.frame(f));
    if (f === 20) sought.ball.drive({ patch: push, weight: 2 });
  }
  expect(got).toEqual(want.slice(11));
});
