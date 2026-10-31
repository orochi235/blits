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
  // Under a span the span itself still leaves once its budget is out: `lapse` in src/spans.ts.
  (kind === 'an owner' ? test : test.fails)(
    `a clip under ${kind} under a reel turned back comes back as the reel runs back over it`,
    () => {
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
    },
  );
}

// docs/schema.html, Time: "a stateless patch reads the same at any rate".
test('a span lays out its children the same at any frame rate', () => {
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

test('queued, staggered and nested spans read the same at 24, 30, 40, 60, 61, 120 and 1000 fps', () => {
  const ids = ['q1', 'q2', 'q3', 's1', 's2', 'n1', 'n2', 'n3'].map((id) => ({ id }));
  const [q1, q2, q3, s1, s2, n1, n2, n3] = ids as [Part, Part, Part, Part, Part, Part, Part, Part];
  const fit = { loop: false, faster: 2, slower: 2 } as const;
  const run = (fps: number) => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const queue = m.span({ start: 0, duration: 600 });
    m.cue({ owner: queue, patch: ramp(150, 0, 1000), subjects: [q1], ...fit });
    m.cue({ owner: queue, patch: ramp(250, 0, 1000), subjects: [q2], ...fit });
    m.cue({ owner: queue, patch: ramp(300, 0, 1000), subjects: [q3], ...fit });
    const stagger = m.span({ start: 0, duration: 500, order: 'stagger', share: 0.9 });
    m.cue({
      owner: stagger,
      patch: ramp(200, 0, 1000),
      subjects: [s1],
      ...fit,
      faster: 3,
      slower: 3,
    });
    m.cue({
      owner: stagger,
      patch: ramp(400, 0, 1000),
      subjects: [s2],
      ...fit,
      faster: 3,
      slower: 3,
    });
    const outer = m.span({ start: 0, duration: 800 });
    const inner = m.span({ owner: outer, duration: 300 });
    m.cue({ owner: inner, patch: ramp(130, 0, 1000), subjects: [n1], ...fit });
    m.cue({ owner: inner, patch: ramp(210, 0, 1000), subjects: [n2], ...fit });
    m.cue({ owner: outer, patch: ramp(370, 0, 1000), subjects: [n3], ...fit });
    const checks = Array.from({ length: 20 }, (_, i) => 37 + 50 * i);
    const steps = Array.from({ length: Math.ceil(fps) }, (_, i) => ((i + 1) * 1000) / fps);
    const frames = [...new Set([...steps, ...checks])].sort((p, q) => p - q);
    const reads: number[] = [];
    for (const t of frames) {
      m.sync(t);
      if (checks.includes(t)) for (const s of ids) reads.push(m.probe(s).x);
    }
    return reads;
  };
  const want = run(1000);
  for (const fps of [24, 30, 40, 60, 61, 120]) {
    const got = run(fps);
    for (const [i, v] of got.entries())
      expect(v, `${fps} fps, read ${i}`).toBeCloseTo(want[i] as number, 6);
  }
});

// The timeline demo: a child's end under an owner whose rate ramps through 0 was taken as the
// frame that noticed it, so the span re-fit from there and the layout followed the frame rate.
test('a span under an owner ramping back lays out as one at rate 1, up to where it turns', () => {
  const build = () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const reel = m.owns({ start: 0 });
    const s = m.span({ owner: reel, start: 0, duration: 500, order: 'stagger', share: 0.5 });
    for (const [ms, subject] of [
      [200, { id: 'first' }],
      [250, { id: 'second' }],
      [400, a],
    ] as const)
      m.cue({
        owner: s,
        patch: ramp(ms, 0, 1000),
        subjects: [subject],
        loop: false,
        faster: 3,
        slower: 3,
      });
    return { m, reel };
  };
  const { m, reel } = build();
  for (let f = 1; f <= 18; f++) {
    if (f === 4) reel.ramp(-1, 900);
    m.sync((f * 1000) / 60);
  }
  // From mix 50 the reel reads 50 + dt - dt² / 900: 230.56 at mix 300.
  const fresh = build().m;
  for (let t = 1; t <= 230; t++) fresh.sync(t);
  fresh.sync(50 + 250 - 250 ** 2 / 900);
  expect(fresh.probe(a).x).toBeGreaterThan(0);
  expect(m.probe(a).x).toBeCloseTo(fresh.probe(a).x, 6);
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

// docs/schema.html, Score, Seeking: a mix sought back plays on "as it stood at the end of that
// frame"; and CHANGELOG 0.16.0, turning an owner back "reverses completely". A stagger span run back
// over and played forward again, then sought back into, reads as one played straight through.
test('a span the reel ran back over keeps its layout forward again and through a seek', () => {
  const parts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const make = () => {
    const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
    m.sync(0);
    const reel = m.owns({ start: 0 });
    m.cue({
      owner: reel,
      patch: ramp(10_000, 0, 1),
      start: 0,
      loop: false,
      subjects: [{ id: 'k' }],
    });
    const s = m.span({ owner: reel, start: 0, duration: 1000, order: 'stagger', share: 0.5 });
    parts.forEach((p, i) => {
      const patch = ramp(600 - 50 * i, 100, 400);
      m.cue({ owner: s, patch, subjects: [p], loop: false, faster: 3, slower: 3 });
    });
    return { m, reel };
  };
  const read = (m: Mix<Part, Pose>) => parts.map((p) => m.probe(p).x);
  const fresh = make();
  const straight = new Map<number, number[]>();
  for (let t = 10; t <= 900; t += 10) {
    fresh.m.sync(t);
    straight.set(t, read(fresh.m));
  }
  const { m, reel } = make();
  let at = 0;
  let host = 0;
  const to = (end: number, check: boolean) => {
    reel.rate = end > at ? 1 : -1;
    while (at !== end) {
      host += 10;
      at += reel.rate * 10;
      m.sync(host);
      if (check && reel.rate > 0)
        read(m).forEach((v, i) => expect(v).toBeCloseTo(straight.get(at)?.[i] as number, 9));
    }
  };
  // Turned back before a ends, so no fit has changed a rate yet: see the test after this one.
  to(400, false);
  to(50, false);
  to(300, true);
  // Mix time 800 is where the reel read 100 on its way forward again.
  m.seek(800);
  at = 100;
  to(900, true);
});

// CHANGELOG 0.16.0: turning an owner back "reverses completely". A fit changes a playing child's
// rate as a sibling ends, and the child's clock run back reads its new rate all the way back.
test.fails('a child a fit sped up reads, run back over, what it read going forward', () => {
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const reel = m.owns({ start: 0 });
  m.cue({ owner: reel, patch: ramp(10_000, 0, 1), start: 0, loop: false, subjects: [{ id: 'k' }] });
  const s = m.span({ owner: reel, start: 0, duration: 1000, order: 'stagger', share: 0.9 });
  for (const [i, id] of ['first', 'a', 'c', 'd', 'e'].entries())
    m.cue({
      owner: s,
      patch: ramp(600 - 50 * i, 100, 400),
      subjects: [id === 'a' ? a : { id }],
      loop: false,
      faster: 3,
      slower: 3,
    });
  // The first ends near 262 and the fit then speeds a up, which started near 236.
  const forward = x(m, 250);
  x(m, 300);
  reel.rate = -1;
  expect(x(m, 350)).toBeCloseTo(forward, 9);
});
