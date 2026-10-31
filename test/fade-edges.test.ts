import { expect, test } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Mix } from '../src/types.js';

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };
const ten = patch<Part, Pose>(0, () => ({ x: 10 }), { writes: ['x'] });
const ramp = (ms: number, from: number, to: number) =>
  keys<Part, Pose>(
    ms,
    [
      { at: 0, delta: { x: from } },
      { at: 1, delta: { x: to } },
    ],
    { ease: 'linear' },
  );
const x = (m: Mix<Part, Pose>, t: number) => {
  m.sync(t);
  return m.probe(a).x;
};

for (const lanes of [true, false]) {
  // Handle.rise: "It climbs back from where its fade had got to"; rise.test.ts: "no jump where it turns".
  test(`rise during a fade in has no jump, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: ten, fade: { in: 100, out: 100 } });
    x(m, 0);
    expect(x(m, 50)).toBeCloseTo(5, 9);
    h.fade();
    const before = x(m, 70); // 0.5 * 0.8 = 4
    h.rise({ over: 100 });
    expect(x(m, 70)).toBeCloseTo(before, 9);
    // The fade in climbs on from 0.5, 20 ms behind: 0.6 at 80, times the rise's 0.9.
    expect(x(m, 80)).toBeCloseTo(5.4, 9);
    expect(x(m, 120)).toBeCloseTo(10, 9);
  });

  // envelope(): "A fade in stops climbing where a fade out begins, or the two ramps multiply into a rise."
  test(`a subject faded out during its fade in never rises, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: ten, fade: { in: 100 } });
    x(m, 0);
    expect(x(m, 50)).toBeCloseTo(5, 9);
    h.fade({ subject: a, over: 100 });
    expect(x(m, 60)).toBeCloseTo(4.5, 9);
  });

  test(`a subject's fade in stays held past where it would have ended, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: ten, fade: { in: 100 } });
    x(m, 0);
    x(m, 50);
    h.fade({ subject: a, over: 200 });
    expect(x(m, 120)).toBeCloseTo(10 * 0.5 * 0.65, 9);
  });

  // ownWeight: "Its fade in counts from when it started".
  test(`an owner's fade in under an owner turned back stays done, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const outer = m.owns({ start: 0 });
    const inner = m.owns({ owner: outer, start: 0, fade: { in: 100 } });
    m.cue({ owner: inner, patch: ramp(1000, 0, 1000), start: 0 });
    expect(x(m, 50)).toBeCloseTo(25, 6);
    expect(x(m, 500)).toBeCloseTo(500, 6);
    outer.rate = -1;
    expect(x(m, 600)).toBeCloseTo(400, 6);
  });

  test(`an owner's fade in under a slowed owner counts from where it started, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const outer = m.owns({ start: 0 });
    const inner = m.owns({ owner: outer, start: 0, fade: { in: 100 } });
    m.cue({ owner: inner, patch: ramp(1000, 0, 1000), start: 0 });
    expect(x(m, 50)).toBeCloseTo(25, 6);
    outer.rate = 0.25;
    expect(x(m, 90)).toBeCloseTo(0.9 * 60, 6);
  });

  // VoiceFade.at: "at or behind now, the fade began then and is partway".
  test(`fade at now under an owner turned back begins now, lanes ${lanes}`, () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const o = m.owns({ start: 0 });
    const c = m.cue({ owner: o, patch: ramp(1000, 0, 1000), start: 0 });
    x(m, 500);
    o.rate = -1;
    expect(x(m, 600)).toBeCloseTo(400, 6);
    c.fade({ at: 600, over: 100 });
    expect(x(m, 650)).toBeCloseTo(350 * 0.5, 6);
  });
}
