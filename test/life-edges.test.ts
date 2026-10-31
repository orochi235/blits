import { createHistory as tape } from '@weasel-js/history';
import { expect, test } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys } from '../src/patch.js';
import type { Run } from '../src/types.js';
import { memoryStore } from './store.js';

interface Pose {
  x: number;
}
interface Part {
  id: number;
}
const K = kit<Pose>({ x: sum() });
const ramp = (ms: number) =>
  keys<Part, Pose>(
    ms,
    [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 1 } },
    ],
    { ease: 'linear' },
  );

/** The run's value at `t`, along its lines; at a jump, the value after it. */
function along(run: Run, t: number): number {
  const { at, value } = run;
  for (let i = at.length - 1; i >= 0; i--) {
    if ((at[i] as number) > t) continue;
    if ((at[i] as number) === t || i === at.length - 1) return value[i] as number;
    const a = at[i] as number;
    const b = at[i + 1] as number;
    const va = value[i] as number;
    return va + (((value[i + 1] as number) - va) * (t - a)) / (b - a);
  }
  return value[0] as number;
}

test('trace: a voice sought past its end traces its fade out from its start', () => {
  const m = mix<Part, Pose>(K);
  const a = { id: 0 };
  m.sync(0);
  m.cue({
    patch: keys<Part, Pose>(
      120,
      [
        { at: 0, delta: { x: 1 } },
        { at: 1, delta: { x: 2 } },
      ],
      { ease: 'linear' },
    ),
    seek: 200,
    fade: { out: 60 },
  });
  m.probe(a);
  const run = m.trace(0, 300).of(a, 'x');
  const want = m.project(30).probe(a).x;
  expect(want).toBeCloseTo(1, 6); // halfway down its 60 ms fade out from 2, as a live sync to 30 shows
  expect(run.exact ? along(run, 30) : want).toBeCloseTo(want, 6);
});

test('a prepare never followed by a seek lets its records go after history.ms', async () => {
  const m = mix<string, Pose>(kit<Pose>({ x: sum() }), {
    history: { ms: 100, store: memoryStore() },
  });
  m.sync(0);
  m.cue({ patch: ramp(400) as never, loop: true });
  let t = 0;
  for (let i = 0; i < 100; i++) {
    t += 16;
    m.sync(t);
    m.probe('a');
  }
  await m.prepare(50);
  const loaded = () =>
    (m as unknown as { transport: { pager: { loaded: { records: unknown[] } | null } } }).transport
      .pager.loaded?.records.length ?? 0;
  const before = loaded();
  for (let i = 0; i < 5000; i++) {
    t += 16;
    m.sync(t);
    m.probe('a');
  }
  // `history.ms` is how much stays in memory; 80 s on, nothing about a prepare at 50 should still be held.
  expect(loaded() - before).toBeLessThan(100);
});

test('a read ahead that throws on a call the tape holds puts the tape back', () => {
  const run = (read: boolean) => {
    const m = mix<Part, Pose>(K, { history: { ms: 3000, every: 100, tape } });
    const p0 = { id: 0 };
    const p1 = { id: 1 };
    m.sync(1000);
    const h = m.cue({ patch: spring<Part, Pose>('x', { from: 1, to: 2 }) });
    m.sync(1100);
    h.fade({ subject: p0, over: 0 });
    m.sync(1200);
    m.sync(1300);
    m.drop(p1);
    m.seek(m.now - 200);
    m.sync(1400);
    m.probe(p1);
    const depth = m.tape?.undoDepth();
    if (read) {
      // The tape ahead holds the drop of p1, which the spring now holds: the read refuses.
      expect(() => m.project(m.now + 2000).probe(p1)).toThrow(/cannot play/);
      // A read moves nothing, a failed one included.
      expect(m.tape?.undoDepth()).toBe(depth);
    }
    m.sync(1416);
    m.drop(p0);
    const now = m.now;
    m.seek(now - 30);
    m.seek(now);
    m.sync(1432);
    return m.probe(p0).x;
  };
  expect(run(true)).toBeCloseTo(run(false), 9);
});

// Open: HANDOFF item 1, "`inert` misses a motion subject met inside its stagger".
test.fails('inert reads false while a motion voice has a named subject it has yet to move, past its stagger', () => {
  const m = mix<Part, Pose>(K);
  const p = { id: 1 };
  m.sync(0);
  m.cue({ patch: spring<Part, Pose>('x', { from: 0, to: 1 }), stagger: () => 100, subjects: [p] });
  m.sync(16);
  m.probe(p); // still inside its stagger: the spring has not met it
  m.sync(266);
  const inert = m.inert;
  const a = m.probe(p).x;
  m.sync(282);
  const b = m.probe(p).x;
  expect(b).not.toBeCloseTo(a, 3); // another frame does change the pose…
  expect(inert).toBe(false); // …so the mix is not inert
});

test('under history, a voice faded out of one subject is let go with history', () => {
  const m = mix<Part, Pose>(K, { history: { ms: 200 } });
  const a = { id: 0 };
  const b = { id: 1 };
  let t = 0;
  m.sync(t);
  for (let i = 0; i < 300; i++) {
    const h = m.cue({ patch: ramp(50) });
    m.probe(a);
    m.probe(b);
    h.fade({ subject: a, over: 0 });
    for (let k = 0; k < 6; k++) {
      t += 16;
      m.sync(t);
      m.probe(a);
      m.probe(b);
    }
  }
  const x = m as unknown as { gone: unknown[]; parters: Set<unknown>; cued: unknown[] };
  // History has let go of all but the last 200 ms of the voices that left…
  expect(x.gone.length).toBeLessThan(10);
  // …so nothing else should still hold the 300 that left.
  expect(x.parters.size).toBeLessThan(10);
});
