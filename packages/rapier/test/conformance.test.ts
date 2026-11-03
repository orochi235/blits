import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { checkDriver, type DriverMixOptions } from '@msb235/blits/testing';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';

await R2.init();

it('passes checkDriver: every body’s pose, frame by frame', () => {
  const problems = checkDriver({
    tape,
    // A seek replays the world from the copy history keeps, so the poses come back.
    restores: true,
    make(opts: DriverMixOptions) {
      const sim = physics<Pose2>(kit<Pose2>(channels2), {
        rapier: R2,
        name: opts.name,
        ...(opts.transport ? { transport: opts.transport } : { history: opts.history }),
      });
      sim.body(R2.RigidBodyDesc.fixed(), R2.ColliderDesc.cuboid(10, 0.1));
      const bodies = [0, 1].map((i) =>
        sim.body(
          R2.RigidBodyDesc.dynamic().setTranslation(i * 0.3, 1 + i),
          R2.ColliderDesc.cuboid(0.25, 0.25),
        ),
      );
      bodies[0]?.drive({
        patch: patch<object, Pose2>(2000, (p) => ({ force: [Math.sin(p * Math.PI * 2) * 3, 0] }), {
          writes: ['force'],
        }),
        loop: true,
      });
      return {
        mix: sim.mix,
        frame: () => sim.step(),
        output: () =>
          bodies.map((b) => {
            const p = sim.mix.probe(b) as unknown as { position: number[]; rotation: number };
            return [...p.position, p.rotation];
          }),
      };
    },
  });
  expect(problems).toEqual([]);
});
