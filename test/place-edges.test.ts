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

// docs/schema.html, Time: "a stateless patch reads the same at any rate".
test('a span child placed at a start already past by a sibling lapsing starts in that frame', () => {
  const c = { id: 'c' };
  const m = mix<Part, Pose>(K);
  m.sync(0);
  const s = m.span({ duration: 5000 });
  const a = m.span({ owner: s, duration: 1000 });
  const b = m.span({ owner: s, duration: 1000 });
  m.cue({ owner: b, patch: ramp(1000, 0, 100), subjects: [c], loop: false });
  m.sync(100);
  // a reads 1050 at 100, so it lapsed at 50, and b and c start there.
  a.seek(1050);
  m.sync(110);
  expect(m.probe(c).x).toBeCloseTo(6, 9);
  m.sync(120);
  expect(m.probe(c).x).toBeCloseTo(7, 9);
});

// CHANGELOG 0.16.0 and Unreleased: a span lays out its children the same at any frame rate.
test('a sibling queued after a span sought ahead starts where that span lapses, at any frame rate', () => {
  const b = { id: 'b' };
  const run = (frames: number[]) => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const s = m.span({ duration: 1000 });
    const inner = m.span({ owner: s, duration: 500 });
    m.cue({ owner: s, patch: ramp(300, 0, 100), subjects: [b], loop: false });
    m.sync(10);
    // Its clock reads 100 at 10: it lapses at 410, and b starts there, not at 500.
    inner.seek(100);
    for (const t of frames) m.sync(t);
    return m.probe(b).x;
  };
  expect(run(Array.from({ length: 51 }, (_, i) => 20 + 10 * i))).toBeCloseTo(110 / 3, 9);
  expect(run([520])).toBeCloseTo(110 / 3, 9);
});
