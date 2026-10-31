import { createHistory as tape } from '@weasel-js/history';
import { expect, test } from 'vitest';
import { kit, max, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';

// What the stress demos in apps/stress found. Each `test.fails` asserts the documented behavior and
// fails today; once blits is fixed it starts failing, and its `.fails` comes off.

interface Pose {
  x: number;
}
interface Part {
  id: string;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };
const ramp = (ms: number, from: number, to: number) =>
  keys<Part, Pose>(
    ms,
    [
      { at: 0, delta: { x: from } },
      { at: 1, delta: { x: to } },
    ],
    { ease: 'linear' },
  );

const x = (m: Mix<Part, Pose>, at: number) => {
  m.sync(at);
  return m.probe(a).x;
};

// CHANGELOG 0.16.0: "turning an owner back (a rate below 0) brings back the children that already
// left, so playback reverses completely". A direct child of the reel does come back.
const nested: Record<string, (m: Mix<Part, Pose>, reel: Handle<Part>) => Handle<Part>> = {
  'an owner': (m, reel) => m.owns({ owner: reel, start: 0 }),
  'a span': (m, reel) => m.span({ owner: reel, start: 0, duration: 300 }),
  'a span in a span': (m, reel) =>
    m.span({ owner: m.span({ owner: reel, start: 0, duration: 300 }), duration: 300 }),
};
for (const [kind, holder] of Object.entries(nested)) {
  test.fails(`a clip under ${kind} under a reel turned back comes back as the reel runs back over it`, () => {
    const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
    m.sync(0);
    const reel = m.owns({ start: 0 });
    // Keeps the reel playing after the clip has left.
    m.cue({ owner: reel, patch: ramp(300, 0, 1), loop: true, start: 0, subjects: [{ id: 'k' }] });
    const inner = holder(m, reel);
    m.cue({
      owner: inner,
      patch: ramp(300, 100, 400),
      loop: false,
      ...(kind === 'an owner' ? { start: 0 } : {}),
    });
    expect(x(m, 250)).toBe(350);
    x(m, 500);
    reel.rate = -1;
    // The reel reads 300 at mix 700 and 250 at 750.
    expect(x(m, 750)).toBeCloseTo(350, 9);
  });
}

// docs/schema.html, Time: "a stateless patch reads the same at any rate".
test.fails('a span lays out its children the same at any frame rate', () => {
  const at300 = (stepMs: number) => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const s = m.span({ start: 0, duration: 500, order: 'stagger', share: 0.9 });
    m.cue({
      owner: s,
      patch: ramp(200, 0, 1000),
      subjects: [{ id: 'first' }],
      loop: false,
      faster: 3,
      slower: 3,
    });
    m.cue({
      owner: s,
      patch: ramp(400, 0, 1000),
      subjects: [a],
      loop: false,
      faster: 3,
      slower: 3,
    });
    // The second starts at 155.2 and the first ends at 172.4: a 25 ms step puts no frame between.
    for (let t = stepMs; t <= 300; t += stepMs) m.sync(t);
    return m.probe(a).x;
  };
  expect(at300(10)).toBeCloseTo(420, 6);
  expect(at300(25)).toBeCloseTo(420, 6);
});

// docs/schema.html, Score, Seeking: "mix.seek(t) moves the live mix to mix time t, as it stood at the end of
// that frame, and it plays on from there"; an owner placed by `start: 2000` does.
test.fails('an owner anchored to start at 2000 has not started after a seek back to 1000', () => {
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const o = m.owns({ anchor: { start: 2000 } });
  m.cue({ owner: o, patch: ramp(300, 100, 400), loop: false, start: 0 });
  expect(x(m, 2100)).toBe(200);
  m.seek(1000);
  expect(x(m, 2200)).toBe(0);
});

// docs/schema.html, Score, Seeking, Back: "Voices that left after it are back on the handles the host
// holds"; the same voice under an owner stays back.
test.fails('a voice anchored to end at 4000 stays back after a seek to 1000', () => {
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const h = m.cue({
    patch: ramp(300, 0, 100),
    loop: false,
    freeze: 'after',
    anchor: { end: 4000 },
  });
  x(m, 1000);
  expect(x(m, 5000)).toBe(0);
  m.seek(1000);
  expect([m.probe(a).x, h.state]).toEqual([100, 'frozen']);
  expect([x(m, 5001), h.state]).toEqual([100, 'frozen']);
});

// docs/schema.html, Score: "A placement that waits on itself is refused at cue." Here q2 starts off
// q1's coast, which q1's out does not move, so nothing waits on itself; by tag it is taken.
test.fails('a cue whose out names its follow’s start, the follow starting off its coast, is taken', () => {
  const L = kit<{ level: number }>({ level: max() });
  const step = () => keys<Part, { level: number }>(100, [{ at: 1, delta: { level: 1 } }]);
  const m = mix<Part, { level: number }>(L);
  m.sync(0);
  m.cue({
    patch: step(),
    name: 'q1',
    freeze: 'after',
    anchor: { out: { of: 'q2', mark: 'start' } },
  });
  m.cue({
    patch: step(),
    name: 'q2',
    freeze: 'after',
    anchor: { start: { of: 'q1', mark: 'coast', by: 50 } },
  });
  m.sync(16);
  const at = (name: string, mark: string) =>
    m.marks(0, 1000).find((k) => k.name === name && k.mark === mark)?.timestamp;
  expect([at('q1', 'out'), at('q2', 'start')]).toEqual([150, 150]);
});
