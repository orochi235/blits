import { describe, expect, it } from 'vitest';
import { kit, type Vec, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { angle, quat } from '../src/rotation.js';
import type { Mix } from '../src/types.js';

interface Part {
  id: number;
}
interface Pose {
  heading: number;
  spin: Vec<4>;
}
type M = Mix<Part, Pose>;

const K = kit<Pose>({ heading: angle(), spin: quat() });
const PARTS: Part[] = [0, 1, 2, 3].map((id) => ({ id }));
const TIMES = [0, 100, 250, 600, 900, 1300];

const about = (axis: 0 | 1 | 2, deg: number): Vec<4> => {
  const half = (deg * Math.PI) / 360;
  const q: Vec<4> = [0, 0, 0, Math.cos(half)];
  q[axis] = Math.sin(half);
  return q;
};

const sway = (ms: number) =>
  keys<Part, Pose>(ms, [
    { at: 0, delta: { heading: 350, spin: about(1, 0) } },
    { at: 0.5, delta: { heading: 10, spin: about(1, 170) } },
    { at: 1, delta: { heading: 200, spin: about(2, -90) } },
  ]);
const veer = (ms: number) =>
  patch<Part, Pose>(
    ms,
    (ph, s) => ({ heading: 720 * ph + 40 * s.id, spin: about(0, 300 * ph + 20 * s.id) }),
    { writes: ['heading', 'spin'] },
  );

const lanedOf = (m: M): string[] =>
  (m as unknown as { lanes: { laned: { name: string }[] } | null }).lanes?.laned.map(
    (ch) => ch.name,
  ) ?? [];

/** Every part's pose at each of `TIMES`, and the channels on lanes at the end. */
function play(lanes: boolean, cue: (m: M) => void): { read: unknown[]; laned: string[] } {
  const m = mix<Part, Pose>(K, { lanes });
  cue(m);
  const read = TIMES.flatMap((t) => {
    m.sync(t);
    return PARTS.map((s) => structuredClone(m.probe(s)));
  });
  return { read, laned: lanedOf(m) };
}

const SCENES: Record<string, { cue: (m: M) => void; laned: string[] }> = {
  'keys and a fn, one at a weight': {
    cue: (m) => {
      m.cue({ patch: sway(800), loop: true });
      m.cue({ patch: veer(500), loop: true, weight: 0.6 });
    },
    laned: ['heading', 'spin'],
  },
  'keys staggered and weighted by a signal': {
    cue: (m) => {
      m.cue({ patch: sway(700), loop: true, stagger: (s: Part) => s.id * 30 });
      m.cue({ patch: sway(450), loop: true, weight: (s: Part) => 0.25 + 0.2 * s.id });
    },
    laned: ['heading', 'spin'],
  },
  'a tween on the angle, under a fade in': {
    cue: (m) => {
      m.cue({
        patch: tween<Part, Pose>('heading', { from: 350, to: (s) => 20 + 100 * s.id, ms: 1000 }),
        fade: { in: 300 },
      });
      m.cue({ patch: veer(500), loop: true, weight: 0.5 });
    },
    laned: ['heading', 'spin'],
  },
  'a voice per part: keys, a fn and a tween': {
    cue: (m) => {
      for (const s of PARTS) {
        m.cue({ patch: sway(600 + 50 * s.id), loop: true, subjects: [s] });
        m.cue({ patch: veer(400), loop: true, subjects: [s], weight: 0.7 });
        m.cue({
          patch: tween<Part, Pose>('heading', { from: 0, to: 190 + s.id, ms: 900 }),
          subjects: [s],
        });
      }
    },
    laned: ['heading', 'spin'],
  },
  'a locus around a voice outside it': {
    cue: (m) => {
      m.cue({ patch: veer(300), loop: true, locus: 'a', weight: 0 });
      m.cue({ patch: veer(650), loop: true, weight: 0.8 });
      m.cue({ patch: sway(500), loop: true, locus: 'a', weight: 0.5 });
      m.cue({ patch: veer(900), loop: true, locus: 'a', weight: (s: Part) => 0.2 * s.id });
    },
    laned: ['heading', 'spin'],
  },
};

describe('an angle and a quat on a lane', () => {
  for (const [name, { cue, laned }] of Object.entries(SCENES))
    it(`reads as the general path does: ${name}`, () => {
      const on = play(true, cue);
      expect(on.laned).toEqual(laned);
      expect(on.read).toEqual(play(false, cue).read);
    });

  it('goes the short way round on a lane', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    m.cue({
      patch: keys<Part, Pose>(1000, [
        { at: 0, delta: { heading: 350 } },
        { at: 1, delta: { heading: 10 } },
      ]),
    });
    m.sync(0);
    m.probe(PARTS[0] as Part);
    m.sync(500);
    expect(lanedOf(m)).toEqual(['heading']);
    // 350 to 10 passes 360, which is 0 the short way round.
    expect(m.probe(PARTS[0] as Part).heading).toBeCloseTo(0, 9);
  });

  it('keeps a vec of angles off lanes', () => {
    const m = mix<Part, { turns: number[] }>(kit({ turns: vec(2, angle()) }), { lanes: true });
    m.cue({
      patch: patch<Part, { turns: number[] }>(100, () => ({ turns: [350, 10] }), {
        writes: ['turns'],
      }),
    });
    m.sync(0);
    m.probe(PARTS[0] as Part);
    expect((m as unknown as { lanes: { laned: unknown[] } | null }).lanes?.laned.length ?? 0).toBe(
      0,
    );
  });
});
