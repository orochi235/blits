import { describe, expect, it } from 'vitest';
import { kit, last, mul, sum, type Vec, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { angle } from '../src/rotation.js';
import type { Mix } from '../src/types.js';

interface Pose {
  pos: Vec<3>;
  size: Vec<2>;
  x: number;
  turns: Vec<2>;
  tag: Vec<2>;
}
const K = kit<Pose>({
  pos: vec(3, sum()),
  size: vec(2, mul()),
  x: sum(),
  turns: vec(2, angle()),
  tag: vec(2, last()),
});
interface Part {
  id: number;
}
const A: Part = { id: 0 };
const PARTS: Part[] = [0, 1, 2].map((id) => ({ id }));

const at = (pos: Vec<3>) => patch<Part, Pose>(0, () => ({ pos }), { writes: ['pos'] });
const read = (m: Mix<Part, Pose>, s: Part = A) => {
  m.sync(0);
  return m.probe(s);
};

describe('axes: a weight per axis of a vec', () => {
  it('moves only the axes it weighs', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: at([4, 5, 6]), axes: { pos: [0, 1, 0] } });
    expect(read(m).pos).toEqual([0, 5, 0]);
  });

  it('multiplies each axis weight into the voice weight', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: at([4, 8, 6]), weight: 0.5, axes: { pos: [0.5, 1, 0] } });
    expect(read(m).pos).toEqual([1, 4, 0]);
  });

  it('fades a mul vec toward 1 axis by axis', () => {
    const m = mix<Part, Pose>(K);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ size: [3, 3] }), { writes: ['size'] }),
      axes: { size: [0, 0.5] },
    });
    expect(read(m).size).toEqual([1, 2]);
  });

  it('leaves the voice whole on channels it names no axes for', () => {
    const m = mix<Part, Pose>(K);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ pos: [1, 1, 1], x: 7 }), { writes: ['pos', 'x'] }),
      weight: 0.5,
      axes: { pos: [1, 0, 1] },
    });
    const p = read(m);
    expect(p.pos).toEqual([0.5, 0, 0.5]);
    expect(p.x).toBe(3.5);
  });

  it('in a role, shares an axis only among the members that weigh it', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: at([1, 2, 3]), role: 'arm' });
    m.cue({ patch: at([9, 9, 9]), role: 'arm', weight: 0.5, axes: { pos: [0, 1, 0] } });
    const p = read(m).pos;
    expect(p[0]).toBe(1);
    expect(p[1]).toBeCloseTo(2 + 7 / 3, 12);
    expect(p[2]).toBe(3);
  });

  it('in a role, fades an axis with the one member that weighs it', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: at([1, 2, 3]), role: 'arm', axes: { pos: [1, 0, 1] } });
    m.cue({ patch: at([9, 10, 9]), role: 'arm', weight: 0.3, axes: { pos: [0, 1, 0] } });
    const p = read(m).pos;
    expect(p[0]).toBe(1);
    expect(p[1]).toBeCloseTo(3, 12);
    expect(p[2]).toBe(3);
  });

  it('hands one axis over to a hold while the rest keep their clip', () => {
    // An IK arm holding a bone's height: the clip on y gives way as the hold comes in.
    for (const h of [0, 0.25, 0.8, 1]) {
      const m = mix<Part, Pose>(K);
      const clip = at([1, 2, 3]);
      m.cue({ patch: clip, role: 'arm', axes: { pos: [1, 0, 1] } });
      m.cue({ patch: clip, role: 'arm', weight: 1 - h, axes: { pos: [0, 1, 0] } });
      m.cue({ patch: at([0, 9, 0]), role: 'arm', weight: h, axes: { pos: [0, 1, 0] } });
      const p = read(m).pos;
      expect(p[0]).toBe(1);
      expect(p[1]).toBeCloseTo(2 + 7 * h, 12);
      expect(p[2]).toBe(3);
    }
  });

  it('weighs a vec of angles by axis, each meeting at its members’ mean direction', () => {
    const m = mix<Part, Pose>(K);
    const turns = (v: Vec<2>) => patch<Part, Pose>(0, () => ({ turns: v }), { writes: ['turns'] });
    m.cue({ patch: turns([170, 30]), role: 'r' });
    m.cue({ patch: turns([-170, 90]), role: 'r', axes: { turns: [1, 0] } });
    const t = read(m).turns;
    expect(Math.abs(Math.abs(t[0]) - 180)).toBeLessThan(1e-9);
    expect(t[1]).toBeCloseTo(30, 9);
  });

  it('reads the same with lanes on, which it stays off', () => {
    const cue = (m: Mix<Part, Pose>) => {
      m.cue({
        patch: keys<Part, Pose>(400, [
          { at: 0, delta: { pos: [0, 0, 0] } },
          { at: 1, delta: { pos: [4, 8, 2] } },
        ]),
        loop: true,
        role: 'arm',
        axes: { pos: [1, 0.5, 1] },
      });
      m.cue({
        patch: patch<Part, Pose>(300, (ph, s) => ({ pos: [ph, 3 * ph + s.id, 0] }), {
          writes: ['pos'],
        }),
        loop: true,
        role: 'arm',
        weight: (s: Part) => 0.2 + 0.3 * s.id,
        axes: { pos: [0, 1, 0] },
      });
      m.cue({ patch: at([1, 1, 1]), weight: 0.4, axes: { pos: [0.5, 0, 1] } });
    };
    const play = (lanes: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      cue(m);
      return [0, 100, 250, 520].flatMap((t) => {
        m.sync(t);
        return PARTS.map((s) => structuredClone(m.probe(s).pos));
      });
    };
    expect(play(true)).toEqual(play(false));
  });

  it('projects ahead as it plays', () => {
    const m = mix<Part, Pose>(K);
    m.cue({
      patch: patch<Part, Pose>(1000, (ph) => ({ pos: [ph, ph, ph] }), { writes: ['pos'] }),
      axes: { pos: [1, 0, 0.5] },
    });
    m.sync(0);
    m.probe(A);
    const ahead = structuredClone(m.project(500).probe(A).pos);
    m.sync(500);
    expect(m.probe(A).pos).toEqual(ahead);
  });

  it('refuses axes it cannot weigh', () => {
    const m = mix<Part, Pose>(K);
    const both = patch<Part, Pose>(0, () => ({ x: 1, tag: [1, 2] }), { writes: ['x', 'tag'] });
    expect(() => m.cue({ patch: at([1, 1, 1]), axes: { size: [1, 1] } })).toThrow(/does not write/);
    expect(() => m.cue({ patch: both, axes: { x: [1] } })).toThrow(/not a vec/);
    expect(() => m.cue({ patch: both, axes: { tag: [1, 0] } })).toThrow(/no rest/);
    expect(() => m.cue({ patch: at([1, 1, 1]), axes: { pos: [1, 0] } })).toThrow(/3 axes/);
    expect(() => m.cue({ patch: at([1, 1, 1]), axes: { pos: [1, 2, 0] } })).toThrow(/0 to 1/);
  });
});
