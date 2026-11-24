import R2 from '@dimforge/rapier2d-compat';
import { type HistoryStore, kit, transport } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { afterEach, expect, it, vi } from 'vitest';
import { channels2, type Pose2, physics, physicsStore, type RapierModule } from '../src/index.js';
import { at } from './scenes.js';

await R2.init();

const gc = (globalThis as { gc?: () => void }).gc as () => void;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

/** Rapier's 2D module, keeping every world it makes, by `new` or from a snapshot. */
function counted() {
  const made: R2.World[] = [];
  class World extends R2.World {
    constructor(g: R2.Vector) {
      super(g);
      made.push(this);
    }
    static override restoreSnapshot(bytes: Uint8Array) {
      const w = R2.World.restoreSnapshot(bytes);
      made.push(w);
      return w;
    }
  }
  const free = vi.spyOn(R2.World.prototype, 'free');
  const freed = () => free.mock.contexts as R2.World[];
  return { rapier: { World } as unknown as RapierModule, made, freed };
}

/** A box falling onto a floor, played to frame 120 and sought back twice on the way. */
function played(rapier: RapierModule, store?: HistoryStore) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier,
    name: 'closed',
    history: { ms: 10_000, every: 250, tape, ...(store ? { store } : {}) },
  });
  sim.body(R2.RigidBodyDesc.fixed(), R2.ColliderDesc.cuboid(10, 0.1));
  sim.body(R2.RigidBodyDesc.dynamic().setTranslation(0, 3), R2.ColliderDesc.cuboid(0.25, 0.25));
  let shift = 0;
  for (let f = 0; f <= 60; f++) sim.sync(at(f));
  sim.mix.seek(at(20));
  shift += at(60) - at(20);
  for (let f = 21; f <= 90; f++) sim.sync(at(f) + shift);
  sim.mix.seek(at(40));
  shift += at(90) - at(40);
  for (let f = 41; f <= 120; f++) sim.sync(at(f) + shift);
  return sim;
}

it('frees a world a seek replaces, keeping only the one playing', () => {
  const { rapier, made, freed } = counted();
  const sim = played(rapier);
  expect(made.length).toBeGreaterThan(1);
  expect(made.filter((w) => !freed().includes(w))).toEqual([sim.world()]);
});

it('frees every world on close, once, however often it is closed', () => {
  const { rapier, made, freed } = counted();
  const sim = played(rapier);
  sim.close();
  sim.close();
  expect(freed().length).toBe(made.length);
  expect(new Set(freed()).size).toBe(made.length);
  expect(sim.world()).toBeUndefined();
});

it("takes a closed world off its transport's store, which pages no frames back into it", async () => {
  let data: { pushes: object } | undefined = { pushes: {}, holds: {}, goals: {} };
  const frames = new WeakRef(data.pushes);
  const store = physicsStore({
    page() {},
    cut() {},
    async load() {
      const r = { mix: 'closed', stream: 'host', subject: 'blits-rapier frames', at: 1000, seq: 1 };
      const records = data === undefined ? [] : [{ ...r, data }];
      data = undefined;
      return records;
    },
  });
  const t = transport({ history: { ms: 10_000, every: 250, tape, store } });
  const sim = physics<Pose2>(kit<Pose2>(channels2), { rapier: R2, name: 'closed', transport: t });
  sim.body(R2.RigidBodyDesc.dynamic(), R2.ColliderDesc.ball(0.5));
  for (let f = 0; f <= 60; f++) {
    t.sync(at(f));
    sim.step();
  }
  sim.close();
  await store.load(2000);
  // A closed physics on a transport still plays, and steps nothing.
  t.sync(at(61));
  sim.step();
  await turn();
  gc();
  expect(frames.deref()).toBeUndefined();
});
