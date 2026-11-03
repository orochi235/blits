import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

it('plays a kit and patches from another copy of blits, and replays a seek, as from its own', async () => {
  // A query makes a second instance of each module, as a second install of the package would.
  const channels = '../../../src/channels.js?copy';
  const patches = '../../../src/patch.js?copy';
  const other = {
    ...((await import(/* @vite-ignore */ channels)) as { kit: typeof kit }),
    ...((await import(/* @vite-ignore */ patches)) as { patch: typeof patch }),
  };
  expect(other.kit).not.toBe(kit);
  expect(other.patch).not.toBe(patch);
  const run = (k: typeof kit, p: typeof patch) => {
    const sim = physics<Pose2>(k<Pose2>(channels2), {
      rapier: R2,
      history: { ms: 10_000, every: 250, tape },
    });
    sim.body(R2.RigidBodyDesc.fixed(), R2.ColliderDesc.cuboid(10, 0.1));
    const box = sim.body(
      R2.RigidBodyDesc.dynamic().setTranslation(0, 2),
      R2.ColliderDesc.cuboid(0.25, 0.25),
    );
    box.drive({
      patch: p<object, Pose2>(
        2000,
        (phase) => ({ force: [Math.sin(phase * Math.PI * 2) * 4, 0] }),
        { writes: ['force'] },
      ),
    });
    const xs = [];
    for (let f = 0; f <= 120; f++) {
      sim.sync(at(f));
      xs.push([...(sim.mix.probe(box) as Pose2).position]);
    }
    sim.mix.seek(at(30));
    const shift = at(120) - at(30);
    for (let f = 31; f <= 120; f++) sim.sync(at(f) + shift);
    return { xs, replayed: [...(sim.mix.probe(box) as Pose2).position] };
  };
  const ours = run(kit, patch);
  const theirs = run(other.kit, other.patch);
  expect(theirs.xs).toEqual(ours.xs);
  expect(theirs.replayed).toEqual(ours.xs[120]);
  expect(ours.xs[120]).not.toEqual(ours.xs[0]);
});
