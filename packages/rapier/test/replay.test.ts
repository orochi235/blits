import { describe, expect, it } from 'vitest';
import { at, scene2, scene3 } from './scenes.js';

type Scene = typeof scene2 | typeof scene3;

/** A run of `scene`: frame `f` lands on mix time `at(f)`, wherever a seek has put the host's clock. */
function play(scene: Scene) {
  const s = scene();
  let shift = 0;
  return {
    s,
    frame(f: number) {
      s.sim.sync(at(f) + shift);
      return s.bodies.map((b) => {
        const p = s.sim.mix.probe(b) as unknown as { position: number[]; rotation: unknown };
        return [[...p.position], structuredClone(p.rotation)];
      });
    },
    /** Seeks back to frame `to` from frame `from`; the host's clock goes on from where it was. */
    seek(from: number, to: number) {
      s.sim.mix.seek(at(to));
      shift += at(from) - at(to);
    },
  };
}

describe.each([
  ['2D', scene2],
  ['3D', scene3],
] as const)('%s', (_name, scene) => {
  it('replays a seek back to the poses of an uninterrupted run', () => {
    const frames = 360;
    const straight = play(scene);
    const want = [];
    for (let f = 0; f <= frames; f++) want.push(straight.frame(f));

    const sought = play(scene);
    for (let f = 0; f <= frames; f++) sought.frame(f);
    // Back past the impulse at frame 40, so the replay applies it again from the log.
    sought.seek(frames, 20);
    const got = [];
    for (let f = 21; f <= frames; f++) got.push(sought.frame(f));

    expect(got).toEqual(want.slice(21));
    expect(want[21]).not.toEqual(want[frames]);
  });

  it('takes a dropped body out, and brings it back on a seek to before the drop', () => {
    const run = play(scene);
    for (let f = 0; f <= 120; f++) run.frame(f);
    run.s.bodies[0]?.drop();
    for (let f = 121; f <= 240; f++) run.frame(f);
    const [position] = run.frame(241)[0] as [number[]];
    expect(position.every((x) => x === 0)).toBe(true);
    run.seek(241, 60);
    const [back] = run.frame(61)[0] as [number[]];
    expect(back.some((x) => x !== 0)).toBe(true);
  });
});
