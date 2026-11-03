import R2 from '@dimforge/rapier2d-compat';
import R3 from '@dimforge/rapier3d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { channels2, channels3, type Pose2, type Pose3, physics } from '../src/index.js';

await R2.init();
await R3.init();

export const FRAME = 1000 / 60;
export const at = (f: number) => 1000 + f * FRAME;

const history = { ms: 10_000, every: 250, tape };

/** A force that swings back and forth on the mix clock. */
function swing<O>(force: (u: number) => Partial<O>) {
  return patch<object, O>(2000, (phase) => force(Math.sin(phase * Math.PI * 2)), {
    writes: Object.keys(force(0)) as (keyof O)[],
  });
}

/** A floor, three boxes falling and colliding, a swinging force on one and an impulse on another at frame 40. */
export function scene2() {
  const sim = physics<Pose2>(kit<Pose2>(channels2), { rapier: R2, history });
  const floor = R2.ColliderDesc.cuboid(10, 0.1);
  sim.body(R2.RigidBodyDesc.fixed(), floor);
  const bodies = [0, 1, 2].map((i) =>
    sim.body(
      R2.RigidBodyDesc.dynamic()
        .setTranslation(i * 0.3, 2 + i * 1.1)
        .setAngvel(i),
      R2.ColliderDesc.cuboid(0.25, 0.25),
    ),
  );
  bodies[0]?.drive({ patch: swing<Pose2>((u) => ({ force: [u * 4, 0] })) });
  bodies[1]?.drive({ patch: swing<Pose2>((u) => ({ torque: u * 0.3 })), weight: 0.5 });
  let kicked = false;
  const sync = sim.sync;
  sim.sync = (t) => {
    sync(t);
    if (!kicked && sim.mix.timestamp >= 1000 + 40 * FRAME) {
      kicked = true;
      bodies[2]?.impulse([0.4, 1]);
    }
  };
  return { sim, bodies };
}

/** `scene2` in three dimensions. */
export function scene3() {
  const sim = physics<Pose3>(kit<Pose3>(channels3), { rapier: R3, history });
  sim.body(R3.RigidBodyDesc.fixed(), R3.ColliderDesc.cuboid(10, 0.1, 10));
  const bodies = [0, 1, 2].map((i) =>
    sim.body(
      R3.RigidBodyDesc.dynamic()
        .setTranslation(i * 0.3, 2 + i * 1.1, 0)
        .setAngvel({ x: i, y: 0.5, z: 0 }),
      R3.ColliderDesc.cuboid(0.25, 0.25, 0.25),
    ),
  );
  bodies[0]?.drive({ patch: swing<Pose3>((u) => ({ force: [u * 4, 0, 0] })) });
  bodies[1]?.drive({ patch: swing<Pose3>((u) => ({ torque: [0, u * 0.3, 0] })), weight: 0.5 });
  let kicked = false;
  const sync = sim.sync;
  sim.sync = (t) => {
    sync(t);
    if (!kicked && sim.mix.timestamp >= 1000 + 40 * FRAME) {
      kicked = true;
      bodies[2]?.impulse([0.4, 1, 0]);
    }
  };
  return { sim, bodies };
}
