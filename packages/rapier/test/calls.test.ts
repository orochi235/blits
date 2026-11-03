import R2 from '@dimforge/rapier2d-compat';
import { type HistoryStore, kit } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { channels2, type Pose2, physics } from '../src/index.js';
import { at } from './scenes.js';

const gc = (globalThis as { gc?: () => void }).gc as () => void;
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
const nowhere: HistoryStore = { page() {}, load: async () => [], cut() {} };

/** Adds a body before the first sync and one after, keeping only weak references to their descriptions. */
function added(store?: HistoryStore) {
  const sim = physics<Pose2>(kit<Pose2>(channels2), {
    rapier: R2,
    gravity: [0, 0],
    name: 'calls',
    history: { ms: 500, every: 250, tape, ...(store ? { store } : {}) },
  });
  const refs: WeakRef<object>[] = [];
  const add = () => {
    const desc = R2.RigidBodyDesc.dynamic();
    refs.push(new WeakRef(desc));
    sim.body(desc, R2.ColliderDesc.ball(0.5)).impulse([1, 0]);
  };
  add();
  for (let f = 0; f <= 10; f++) sim.sync(at(f));
  add();
  for (let f = 11; f <= 120; f++) sim.sync(at(f));
  return { sim, refs };
}

it('lets go of a call once history can no longer reach it', async () => {
  const { sim, refs } = added();
  await turn();
  gc();
  expect(refs.map((r) => r.deref())).toEqual([undefined, undefined]);
  expect(sim.world()).toBeDefined();
});

it('keeps every call with a history store, which a seek past memory replays', async () => {
  const { sim, refs } = added(nowhere);
  await turn();
  gc();
  expect(refs.every((r) => r.deref() !== undefined)).toBe(true);
  expect(sim.world()).toBeDefined();
});
