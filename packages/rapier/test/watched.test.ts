import R2 from '@dimforge/rapier2d-compat';
import { kit, patch, watched } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { afterEach, expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

afterEach(() => {
  watched().history = undefined;
});

/** A box on a floor swung by a force, in a mix that names no history. */
function swung(name?: string) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), { rapier: R2, ...(name ? { name } : {}) });
  sim.body(R2.RigidBodyDesc.fixed(), R2.ColliderDesc.cuboid(10, 0.1));
  const box = sim.body(
    R2.RigidBodyDesc.dynamic().setTranslation(0, 2),
    R2.ColliderDesc.cuboid(0.25, 0.25),
  );
  box.drive({
    patch: patch<object, Pose2>(
      2000,
      (phase) => ({ force: [Math.sin(phase * Math.PI * 2) * 4, 0] }),
      {
        writes: ['force'],
      },
    ),
  });
  return { sim, x: () => [...(sim.mix.probe(box) as Pose2).position] };
}

it('names its mix, so a debugger lists it', () => {
  const named = (s: ReturnType<typeof swung>) =>
    watched()
      .entries()
      .find((e) => e.mix === s.sim.mix)?.name;
  expect(named(swung())).toBe('physics');
  expect(named(swung('world'))).toBe('world');
});

it('keeps the history a debugger gives mixes that name none, and replays its seek exactly', () => {
  const straight = swung();
  const want = [];
  for (let f = 0; f <= 200; f++) {
    straight.sim.sync(at(f));
    want.push(straight.x());
  }
  watched().history = { ms: 10_000, every: 250, tape };
  const sought = swung();
  for (let f = 0; f <= 200; f++) sought.sim.sync(at(f));
  sought.sim.mix.seek(at(20));
  const shift = at(200) - at(20);
  const got = [];
  for (let f = 21; f <= 200; f++) {
    sought.sim.sync(at(f) + shift);
    got.push(sought.x());
  }
  expect(got).toEqual(want.slice(21));
});
