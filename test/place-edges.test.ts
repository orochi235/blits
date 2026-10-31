import { createHistory as tape } from '@weasel-js/history';
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

// types/mix.ts `rate`: "a start ahead of a paused mix waits for the host's clock to reach it", and a seek back\nplays the recorded calls again as the host made them.
test('a voice cued with a start ahead of a paused mix waits for it after a seek back too', () => {
  const e = { id: 'e' };
  const m = mix<Part, Pose>(K, { history: { ms: 100_000, tape } });
  m.sync(0);
  m.sync(300);
  m.rate = 0;
  m.sync(400);
  // Host 700: the mix reads 300 until host 500, then runs at 1, so this starts at mix 500.
  m.cue({ patch: ramp(200, 0, 100), subjects: [e], loop: false, freeze: 'after', start: 700 });
  m.sync(500);
  m.rate = 1;
  const live: number[] = [];
  for (let t = 510; t <= 800; t += 10) {
    m.sync(t);
    live.push(m.probe(e).x);
  }
  expect([live[18], live[19], live[20]]).toEqual([0, 0, 5]);
  m.seek(200);
  // The next sync reads mix 210; the cue plays again at host 1000 + 200, the rate at 1000 + 300.
  const again: number[] = [];
  for (let t = 810; t <= 1400; t += 10) {
    m.sync(t);
    if (t >= 1110) again.push(m.probe(e).x);
  }
  expect(again).toEqual(live);
});
