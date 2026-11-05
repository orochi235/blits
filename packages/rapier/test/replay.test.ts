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

  it('replays a seek forward after playing on from a seek back', () => {
    const straight = play(scene);
    const want = [];
    for (let f = 0; f <= 301; f++) want.push(straight.frame(f));

    const sought = play(scene);
    for (let f = 0; f <= 300; f++) sought.frame(f);
    sought.seek(300, 20);
    for (let f = 21; f <= 30; f++) sought.frame(f);
    sought.seek(30, 300);
    expect(sought.frame(301)).toEqual(want[301]);
  });

  it('leaves the calls ahead behind when the host makes one after a seek back, until switchBranch', () => {
    const straight = play(scene);
    const want = [];
    for (let f = 0; f <= 200; f++) {
      want.push(straight.frame(f));
      if (f === 80) straight.s.bodies[0]?.drop();
    }

    const sought = play(scene);
    for (let f = 0; f <= 200; f++) {
      sought.frame(f);
      if (f === 80) sought.s.bodies[0]?.drop();
    }
    sought.seek(200, 20);
    // A call on the mix after the seek back starts a new future, without the kick at 40 or the drop.
    const other = [];
    for (let f = 21; f <= 200; f++) {
      other.push(sought.frame(f));
      if (f === 25) sought.s.sim.mix.announce('again');
    }
    const position = (frame: unknown) => (frame as number[][][])[0]?.[0] as number[];
    expect(position(want[180]).every((x) => x === 0)).toBe(true);
    expect(position(other[180 - 21]).some((x) => x !== 0)).toBe(true);
    expect(other[60 - 21]?.[2]).not.toEqual(want[60]?.[2]);

    sought.seek(200, 20);
    const tape = sought.s.sim.mix.tape;
    const old = tape?.branches().find((b) => !b.current) as { id: number };
    tape?.switchBranch(old.id);
    const got = [];
    for (let f = 21; f <= 200; f++) got.push(sought.frame(f));
    expect(got).toEqual(want.slice(21));
  });

  it('shows the time sought as soon as a seek lands, before the host syncs again', () => {
    const straight = play(scene);
    const want = [];
    for (let f = 0; f <= 120; f++) want.push(straight.frame(f));

    const sought = play(scene);
    for (let f = 0; f <= 120; f++) sought.frame(f);
    const shown = () =>
      sought.s.bodies.map((b) => [
        ...(sought.s.sim.mix.probe(b) as unknown as { position: number[] }).position,
      ]);
    sought.s.sim.mix.seek(at(60));
    // Read before the host syncs again, as a paused host drawing a scrub does.
    expect(shown()).toEqual(want[60]?.map(([p]) => p));
    // The host's clock has not moved, so this frame reads the moment sought too.
    sought.s.sim.sync(at(120));
    expect(shown()).toEqual(want[60]?.map(([p]) => p));
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
