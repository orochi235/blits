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
  test(`a clip under ${kind} under a reel turned back comes back as the reel runs back over it`, () => {
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
test('an owner anchored to start at 2000 has not started after a seek back to 1000', () => {
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const o = m.owns({ anchor: { start: 2000 } });
  m.cue({ owner: o, patch: ramp(300, 100, 400), loop: false, start: 0 });
  expect(x(m, 2100)).toBe(200);
  m.seek(1000);
  expect(x(m, 2200)).toBe(0);
});

// docs/schema.html, Score, Seeking, Back: "Voices that left after it are back on the handles the host
// holds"; the same voice under an owner stays back. So do one placed by `out`, and a loop.
const anchoredOut = {
  'end at 4000': { anchor: { end: 4000 } },
  'out at 4000': { anchor: { out: 4000 } },
  'end at 4000, looping': { anchor: { end: 4000 }, loop: true },
} as const;
for (const [form, spec] of Object.entries(anchoredOut))
  test(`a voice anchored to ${form} stays back after a seek to 1000`, () => {
    const make = () => {
      const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
      m.sync(0);
      const h = m.cue({ patch: ramp(300, 0, 100), loop: false, freeze: 'after', ...spec });
      return { m, h };
    };
    const fresh = make();
    const want = [1000, 1001].map((t) => [x(fresh.m, t), fresh.h.state]);
    const { m, h } = make();
    x(m, 1000);
    x(m, 5000);
    m.seek(1000);
    expect([m.probe(a).x, h.state]).toEqual(want[0]);
    expect([x(m, 5001), h.state]).toEqual(want[1]);
  });

// docs/schema.html, Score: "A placement that waits on itself is refused at cue." Here q2 starts off
// q1's coast, which q1's out does not move, so nothing waits on itself; by tag it is taken.
test('a cue whose out names its follow’s start, the follow starting off its coast, is taken', () => {
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

// A span its clock ran back over keeps the layout it made going forward, so a child cued into it
// then queues after the ones it holds.
test('a child cued into a queue span the reel ran back over plays after its siblings', () => {
  const [p, q, n] = ['p', 'q', 'n'].map((id) => ({ id })) as [Part, Part, Part];
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const reel = m.owns({ start: 0 });
  m.cue({ owner: reel, patch: ramp(10_000, 0, 1), start: 0, loop: false, subjects: [{ id: 'k' }] });
  const s = m.span({ owner: reel, start: 0, duration: 1000 });
  for (const subject of [p, q])
    m.cue({ owner: s, patch: ramp(200, 0, 100), subjects: [subject], loop: false });
  let host = 0;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) m.sync((host += 10));
  };
  step(30);
  reel.rate = -1;
  step(25);
  m.cue({ owner: s, patch: ramp(200, 0, 100), subjects: [n], loop: false });
  reel.rate = 1;
  // The reel reads 50, and runs on 10 ms a frame: q plays 200 to 400, n 400 to 600.
  step(24);
  expect(m.probe(q).x).toBeCloseTo(45, 9);
  expect(m.probe(n).x).toBe(0);
  step(20);
  expect(m.probe(q).x).toBe(0);
  expect(m.probe(n).x).toBeCloseTo(45, 9);
});

// CHANGELOG 0.16.0: turning an owner back "reverses completely". A fit changes a playing child's
// rate as a sibling ends, and the child's clock run back reads its new rate all the way back.
test('a child a fit sped up reads, run back over, what it read going forward', () => {
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
  const later = x(m, 300);
  reel.rate = -1;
  expect(x(m, 350)).toBeCloseTo(forward, 9);
  // And forward again, the fit speeds it up where it did before.
  reel.rate = 1;
  expect(x(m, 400)).toBeCloseTo(later, 9);
});

// docs/schema.html, Score: "A placement that waits on itself is refused at cue." Picked by tag, a
// starts after b and b after a.
test('a loop of placements picked by tag is refused at cue', () => {
  const L = kit<{ level: number }>({ level: max() });
  const step = () => keys<Part, { level: number }>(100, [{ at: 1, delta: { level: 1 } }]);
  const m = mix<Part, { level: number }>(L);
  m.cue({ patch: step(), tags: ['a'], anchor: { start: { after: { tag: 'b' } } } });
  expect(() =>
    m.cue({ patch: step(), tags: ['b'], anchor: { start: { after: { tag: 'a' } } } }),
  ).toThrow(/waits on itself/);
});

// docs/schema.html, owner `seek`: "Moves the owner's clock, and every child's phase with it"; a span
// "fits again when a child joins and when one leaves". A jump past a child fits the rest from where it
// ended on the span's clock, though the reel's clock now puts that before the mix began.
test('a reel sought past a span child lays out the rest of the span as played straight through', () => {
  const [p, q, r] = ['p', 'q', 'r'].map((id) => ({ id })) as [Part, Part, Part];
  const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
  m.sync(0);
  const reel = m.owns({ start: 0 });
  const s = m.span({ owner: reel, start: 0, duration: 3000 });
  for (const subject of [p, q, r])
    m.cue({
      owner: m.span({ owner: s, duration: 1000 }),
      patch: ramp(500, 100, 400),
      subjects: [subject],
      loop: false,
    });
  m.sync(50);
  reel.seek(1100);
  m.sync(100);
  // The reel reads 1200: q's span, 1000 to 2000, is 200 ms in, and r's has yet to start.
  m.sync(150);
  expect([m.probe(q).x, m.probe(r).x]).toEqual([220, 0]);
});

// docs/schema.html, Time: "a stateless patch reads the same at any rate". Two children of a span end
// between two frames, the later cued first: each fit is taken in the order the ends came, so the
// first end's fit, which speeds up the other, moves where that one ends.
test('a span whose children end in one frame, the later cued first, reads the same at any frame rate', () => {
  const lens = [700, 300, 400, 800];
  const parts = lens.map((_, i) => ({ id: `p${i}` }));
  const run = (step: number) => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const s = m.span({ start: 0, duration: 1000, order: 'stagger', share: 0.5 });
    for (const [i, ms] of lens.entries())
      m.cue({
        owner: s,
        patch: ramp(ms, 0, 1000),
        subjects: [parts[i] as Part],
        loop: false,
        faster: 3,
        slower: 3,
      });
    const reads: number[] = [];
    let time = 0;
    for (const at of [150, 310, 470, 630, 790, 950]) {
      const from = time;
      const n = Math.ceil((at - from) / step - 1e-9);
      for (let j = 1; j <= n; j++) {
        time = j === n ? at : from + ((at - from) * j) / n;
        m.sync(time);
      }
      for (const p of parts) reads.push(m.probe(p).x);
    }
    return reads;
  };
  const want = run(1);
  for (const step of [1000 / 60, 25, 1000 / 30, 50])
    for (const [i, v] of run(step).entries())
      expect(v, `${step} ms frames, read ${i}`).toBeCloseTo(want[i] as number, 6);
});

// CHANGELOG 0.16.0: turning an owner back "reverses completely"; docs/schema.html, owner `seek`:
// "Moves the owner's clock, and every child's phase with it". A fit that skips a child is undone
// with the clock: before where it was skipped, the child reads what it read going forward.
for (const how of ['sought back', 'run back', 'sought past it and back'])
  test(`a span whose fit skipped children reads, ${how} before the skip and forward again, as played straight`, () => {
    const lens = [858, 1244, 744, 842, 840, 953, 507, 1557, 1211, 1497];
    const parts = lens.map((_, i) => ({ id: `p${i}` }));
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
      const s = m.span({ owner: reel, start: 0, duration: 2000, order: 'stagger', share: 0.5 });
      for (const [i, p] of parts.entries())
        m.cue({
          owner: s,
          patch: ramp(lens[i] as number, 100, 400),
          subjects: [p],
          loop: false,
          faster: 3,
          slower: 3,
        });
      return { m, reel };
    };
    const read = (m: Mix<Part, Pose>) => parts.map((p) => m.probe(p).x);
    const fresh = make().m;
    for (let t = 10; t <= 60; t += 10) fresh.sync(t);
    const { m, reel } = make();
    let host = 0;
    const to = (end: number) => {
      while (host < end) m.sync((host += 10));
    };
    if (how === 'sought past it and back') {
      to(10);
      reel.seek(5000);
      to(30);
      reel.seek(40);
      to(50);
    } else {
      to(500);
      if (how === 'sought back') {
        reel.seek(50);
        to(510);
      } else {
        reel.rate = -1;
        to(940);
      }
    }
    // The reel reads 60, and runs on with the fresh one.
    reel.rate = 1;
    for (let t = 60; t <= 1000; t += 10) {
      if (t > 60) {
        to(host + 10);
        fresh.sync(t);
      }
      for (const [i, v] of read(m).entries())
        expect(v, `${parts[i]?.id} at ${t}`).toBeCloseTo(read(fresh)[i] as number, 9);
    }
  });

// docs/schema.html, owner `seek`: "Moves the owner's clock, and every child's phase with it". A
// reel sought past a span lays it out in that one frame as played straight through: its children
// start and end in the order they would have, each fit from where the one before left it.
test('a reel sought past a stagger span, then back into it, reads as played straight', () => {
  const lens = [958, 300, 600, 700, 450, 800, 1100, 500, 900, 1300];
  const parts = lens.map((_, i) => ({ id: `p${i}` }));
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
    const s = m.span({ owner: reel, start: 0, duration: 2000, order: 'stagger', share: 0.5 });
    for (const [i, p] of parts.entries())
      m.cue({
        owner: s,
        patch: ramp(lens[i] as number, 100, 400),
        subjects: [p],
        loop: false,
        faster: 3,
        slower: 3,
      });
    return { m, reel };
  };
  const fresh = make().m;
  for (let t = 10; t <= 900; t += 10) fresh.sync(t);
  const { m, reel } = make();
  m.sync(10);
  reel.seek(5000);
  m.sync(20);
  reel.seek(890);
  m.sync(30);
  for (const p of parts) expect(m.probe(p).x, p.id).toBeCloseTo(fresh.probe(p).x, 9);
});

// The same, sought back to before the span's first end and played on: the layout made in the frame
// that passed it stands, and no child left quiet ahead is taken as gone from the fit.
test('a reel sought past a stagger span, then back before it, plays it on as played straight', () => {
  const lens = [958, 300, 600, 700, 450, 800, 1100, 500, 900, 1300];
  const parts = lens.map((_, i) => ({ id: `p${i}` }));
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
    const s = m.span({ owner: reel, start: 0, duration: 2000, order: 'stagger', share: 0.5 });
    for (const [i, p] of parts.entries())
      m.cue({
        owner: s,
        patch: ramp(lens[i] as number, 100, 400),
        subjects: [p],
        loop: false,
        faster: 3,
        slower: 3,
      });
    return { m, reel };
  };
  const fresh = make().m;
  const { m, reel } = make();
  m.sync(10);
  reel.seek(5000);
  m.sync(20);
  reel.seek(0);
  for (let t = 10; t <= 2000; t += 10) {
    fresh.sync(t);
    m.sync(20 + t);
    for (const p of parts) expect(m.probe(p).x, `${p.id} at ${t}`).toBeCloseTo(fresh.probe(p).x, 9);
  }
});
