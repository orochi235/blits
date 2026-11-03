import R2 from '@dimforge/rapier2d-compat';
import R3 from '@dimforge/rapier3d-compat';
import { type HistoryStore, kit, type Paged, patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import {
  channels2,
  channels3,
  type Physics,
  type Pose2,
  type Pose3,
  physics,
} from '../src/index.js';
import { at, FRAME } from './scenes.js';

/** A store that keeps each record only as JSON text, so anything but plain data is lost or throws. */
function jsonStore(): HistoryStore & { size(): number } {
  const held = new Map<string, string>();
  const id = (p: Paged) => [p.mix, p.stream, p.voice, p.subject, p.seq].join('|');
  return {
    size: () => held.size,
    page(out) {
      for (const p of out) held.set(id(p), JSON.stringify(p));
    },
    async load() {
      return [...held.values()].map((s) => JSON.parse(s) as Paged);
    },
    cut(seq) {
      for (const [k, s] of held) if ((JSON.parse(s) as Paged).seq > seq) held.delete(k);
    },
  };
}

const swing = <O>(force: (u: number) => Partial<O>) =>
  patch<object, O>(2000, (phase) => force(Math.sin(phase * Math.PI * 2)), {
    writes: ['force'] as (keyof O)[],
  });

/** Three boxes on a floor, one swung by a force and one kicked at frame 40, paging past 500 ms. */
function scene(dims: 2 | 3, store?: HistoryStore) {
  const history = { ms: 500, every: 250, tape, ...(store ? { store } : {}) };
  const sim = (
    dims === 2
      ? physics<Pose2>(kit<Pose2>(channels2), { rapier: R2, history, name: 'world' })
      : physics<Pose3>(kit<Pose3>(channels3), { rapier: R3, history, name: 'world' })
  ) as Physics<Pose2 | Pose3, Record<string, never>>;
  const R = dims === 2 ? R2 : R3;
  const v = (x: number, y: number) => (dims === 2 ? [x, y] : [x, y, 0]);
  sim.body(
    R.RigidBodyDesc.fixed(),
    dims === 2 ? R2.ColliderDesc.cuboid(10, 0.1) : R3.ColliderDesc.cuboid(10, 0.1, 10),
  );
  const bodies = [0, 1, 2].map((i) => {
    const d = R.RigidBodyDesc.dynamic() as unknown as {
      setTranslation(...xs: number[]): unknown;
    };
    d.setTranslation(...v(i * 0.3, 2 + i * 1.1));
    return sim.body(
      d,
      dims === 2 ? R2.ColliderDesc.cuboid(0.25, 0.25) : R3.ColliderDesc.cuboid(0.25, 0.25, 0.25),
    );
  });
  bodies[0]?.drive({ patch: swing<Pose2 | Pose3>((u) => ({ force: v(u * 4, 0) }) as never) });
  let shift = 0;
  return {
    sim,
    frame(f: number) {
      sim.sync(at(f) + shift);
      if (f === 40) bodies[2]?.impulse(v(0.4, 1));
      return bodies.map((b) => {
        const p = sim.mix.probe(b) as { position: number[]; rotation: unknown };
        return [[...p.position], structuredClone(p.rotation)];
      });
    },
    async seek(from: number, to: number) {
      await sim.mix.prepare(at(to));
      sim.mix.seek(at(to));
      shift += at(from) - at(to);
    },
  };
}

describe.each([2, 3] as const)('%iD, with a history store', (dims) => {
  it('pages the world as plain data and replays a seek back past memory exactly', async () => {
    const frames = 300;
    const straight = scene(dims);
    const want = [];
    for (let f = 0; f <= frames; f++) want.push(straight.frame(f));

    const store = jsonStore();
    const sought = scene(dims, store);
    for (let f = 0; f <= frames; f++) sought.frame(f);
    expect(store.size()).toBeGreaterThan(0);
    // 20 frames is far past the 500 ms memory reaches, and before the kick at frame 40.
    await sought.seek(frames, 20);
    const got = [];
    for (let f = 21; f <= frames; f++) got.push(sought.frame(f));

    expect(got).toEqual(want.slice(21));
    expect(want[21]).not.toEqual(want[frames]);
    expect(FRAME * (frames - 20)).toBeGreaterThan(500);
  });
});
