import { expect, test } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });
const ramp = (ms: number, from: number, to: number) =>
  keys<Part, Pose>(
    ms,
    [
      { at: 0, delta: { x: from } },
      { at: 1, delta: { x: to } },
    ],
    { ease: 'linear' },
  );

// OwnerSpec.rate: an owner cued backward "runs back from 0, before any child placed on its clock".
test('an owner cued backward holds a child at 0 unplayed whether or not a frame lands on its start', () => {
  const a = { id: 'a' };
  const run = (frames: number[]) => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const o = m.owns({ start: 45, rate: -1 });
    const h = m.cue({ owner: o, patch: ramp(200, 0, 100), subjects: [a], loop: false, start: 0 });
    for (const t of frames) m.sync(t);
    return [o.state, h.state];
  };
  expect(run([162])).toEqual(['live', 'pending']);
  expect(run([45, 162])).toEqual(['live', 'pending']);
});
