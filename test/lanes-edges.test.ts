import { expect, test } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Channel } from '../src/types.js';

interface P {
  id: number;
}

// `Handle.weightOf`: "the weight this voice gave `subject` the last frame that subject was probed".
// A voice that moves onto a lane after the subject's probe (here: the voice pinning a shared channel
// off lanes is cut mid-frame) reports the new lane's empty `Row.PROBED`, 0, instead of the 0.5 its
// record holds.
interface OPose {
  x: number;
  v: number;
  odd: number;
}
// Not a stock channel, so never laned: a voice writing it keeps every channel it writes off lanes.
const odd: Channel<number> = {
  rest: 0,
  merge: (a, b) => a + b,
  scale: (v, w) => v * w,
  lerp: (a, b, u) => a + (b - a) * u,
};
test('weightOf for a subject probed before its voice moved onto a lane', () => {
  const run = (lanes: boolean) => {
    const m = mix<P, OPose>(kit<OPose>({ x: sum(), v: sum(), odd }), { lanes });
    const a = { id: 1 };
    const b = { id: 2 };
    const ramp = (w: (keyof OPose)[]) =>
      patch<P, OPose>(1000, (ph) => Object.fromEntries(w.map((c) => [c, ph])) as Partial<OPose>, {
        writes: w,
      });
    m.cue({ patch: ramp(['x']) });
    const h1 = m.cue({ patch: ramp(['v']), weight: 0.5 });
    const h2 = m.cue({ patch: ramp(['v', 'odd']) });
    m.sync(0);
    m.probe(a);
    m.probe(b);
    m.sync(16);
    m.probe(a);
    h2.fade({ over: 0 });
    m.probe(b);
    return [h1.weightOf(a), h1.weightOf(b)];
  };
  // lanes on: [0, 0.5]
  expect(run(true)).toEqual(run(false));
});

// `pull` must give what probing each subject gives, to the bit, and agree with lanes off. Right
// after two voices are cued, a pull meets them in `meet`, which walks `dense` newest first, and
// `foldNow` folds them in that order: voice 2 before voice 1. The general path folds in voice
// order, and a `mul` product of three factors differs in its last bit.
interface GPose {
  g: number;
}
test('pull right after two cues folds them in voice order', () => {
  const ramp = (a: number, b: number) =>
    patch<P, GPose>(400, (ph) => ({ g: a + (b - a) * ph }), { writes: ['g'] });
  const run = (lanes: boolean, pull: boolean) => {
    const m = mix<P, GPose>(kit<GPose>({ g: mul() }), { lanes });
    const a = { id: 0 };
    const b = { id: 1 };
    m.sync(0);
    m.cue({ patch: ramp(0.375, 1.625), weight: 0.55 });
    m.sync(16);
    m.probe(a);
    m.probe(b);
    m.cue({ patch: ramp(1.375, 2), weight: 0.5 });
    m.cue({ patch: ramp(1.75, 1.3), weight: 0.25 });
    m.sync(32);
    const g = new Float64Array(2);
    if (pull) m.pull([a, b], { g });
    else {
      g[0] = m.probe(a).g;
      g[1] = m.probe(b).g;
    }
    return [...g];
  };
  const off = run(false, false);
  // lanes on, pull: [1.0096904999999998, 1.0096904999999998]; every other read: 1.0096905
  expect({ onPull: run(true, true), onProbe: run(true, false), offPull: run(false, true) }).toEqual(
    { onPull: off, onProbe: off, offPull: off },
  );
});
