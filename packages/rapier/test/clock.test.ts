import R2 from '@dimforge/rapier2d-compat';
import { kit, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it, vi } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

/** A 1 kg ball with gravity off, pushed by a force that swings on the mix clock. */
function swung(opts: { maxDt?: number } = {}) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    gravity: [0, 0],
    history: { ms: 10_000, every: 250, tape },
    ...opts,
  });
  const ball = sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5).setMass(1));
  ball.drive({
    patch: patch<object, Pose2>(
      2000,
      (phase) => ({ force: [Math.sin(phase * Math.PI * 2) * 4, 1] }),
      {
        writes: ['force'],
      },
    ),
  });
  return { sim, x: () => [...(sim.mix.probe(ball) as Pose2).position] };
}

it('replays a seek back across a rate ramp and a rate change exactly', () => {
  const s = swung();
  const want = [];
  for (let f = 0; f <= 300; f++) {
    if (f === 60) s.sim.mix.ramp(0.25, 1000);
    if (f === 200) s.sim.mix.rate = 2;
    s.sim.sync(at(f));
    want.push(s.x());
  }
  s.sim.mix.seek(at(50));
  const shift = at(300) - at(50);
  const got = [];
  for (let f = 51; f <= 300; f++) {
    s.sim.sync(at(f) + shift);
    got.push(s.x());
  }
  expect(got).toEqual(want.slice(51));
  expect(want[300]).not.toEqual(want[60]);
});

it('holds the world still at rate 0, and leaves out the time a rebase drops', () => {
  const s = swung();
  for (let f = 0; f <= 30; f++) s.sim.sync(at(f));
  const before = s.x();
  s.sim.mix.rate = 0;
  for (let f = 31; f <= 60; f++) s.sim.sync(at(f));
  expect(s.x()).toEqual(before);

  const a = swung();
  const b = swung();
  for (let f = 0; f <= 30; f++) {
    a.sim.sync(at(f));
    b.sim.sync(at(f));
  }
  // A tab hidden for five seconds comes back. The frame it comes back on counts no time, so the
  // world stands a frame behind one that never left, and is otherwise the same.
  b.sim.mix.rebase();
  for (let f = 31; f <= 61; f++) {
    if (f <= 60) a.sim.sync(at(f));
    b.sim.sync(at(f) + 5000);
  }
  expect(b.sim.mix.now).toBe(a.sim.mix.now);
  expect(b.x()).toEqual(a.x());
});

it('catches a long frame up step by step, or as far as the mix’s maxDt lets it', () => {
  const step = vi.spyOn(R2.World.prototype, 'step');
  const run = (opts: { maxDt?: number }) => {
    const s = swung(opts);
    s.sim.sync(at(0));
    s.sim.sync(at(1));
    step.mockClear();
    s.sim.sync(at(1) + 2000);
    const long = step.mock.calls.length;
    step.mockClear();
    s.sim.sync(at(2) + 2000);
    return [long, step.mock.calls.length];
  };
  // Two seconds at 60 steps a second; under maxDt 100 six, and the rest are dropped, not owed.
  expect(run({})).toEqual([120, 1]);
  expect(run({ maxDt: 100 })).toEqual([6, 1]);
  step.mockRestore();
});

it('replays a frame maxDt capped the same way on a seek', () => {
  const s = swung({ maxDt: 100 });
  const want = [];
  const late = (f: number) => (f >= 100 ? 2000 : 0);
  for (let f = 0; f <= 200; f++) {
    s.sim.sync(at(f) + late(f));
    want.push(s.x());
  }
  s.sim.mix.seek(at(50));
  const shift = at(200) + late(200) - at(50);
  const got = [];
  for (let f = 51; f <= 200; f++) {
    s.sim.sync(at(f) + late(f) + shift);
    got.push(s.x());
  }
  expect(got).toEqual(want.slice(51));
});
