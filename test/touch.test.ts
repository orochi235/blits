import { describe, expect, it } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { patch } from '../src/patch.js';
import type { BookedHit } from '../src/types.js';

interface Pose {
  x: number;
  tag?: string;
}
const K = kit<Pose>({ x: sum(), tag: last<string>() });
interface Part {
  id: string;
}
const a = { id: 'a' };
const b = { id: 'b' };

describe.each([true, false])('touch, lanes %s', (lanes) => {
  /** A mix whose one voice reads each subject's pose out of a table the host edits. */
  const tabled = () => {
    const table = new Map<Part, Pose>([
      [a, { x: 1, tag: 'one' }],
      [b, { x: 10, tag: 'ten' }],
    ]);
    const m = mix<Part, Pose>(K, { lanes });
    m.cue({
      patch: patch<Part, Pose>(0, (_phase, s) => table.get(s) ?? {}, { writes: ['x', 'tag'] }),
    });
    m.sync(0);
    return { m, table };
  };

  it('given a subject, reads that subject again this frame and no other', () => {
    const { m, table } = tabled();
    expect(m.probe(a)).toEqual({ x: 1, tag: 'one' });
    expect(m.probe(b)).toEqual({ x: 10, tag: 'ten' });
    table.set(a, { x: 2, tag: 'two' });
    table.set(b, { x: 20, tag: 'twenty' });
    expect(m.probe(a)).toEqual({ x: 1, tag: 'one' });
    m.touch(a);
    expect(m.probe(a)).toEqual({ x: 2, tag: 'two' });
    expect(m.probe(b)).toEqual({ x: 10, tag: 'ten' });
    expect(m.probe(a)).toEqual({ x: 2, tag: 'two' });
  });

  it('given none, reads every subject again, by probe and by pull', () => {
    const { m, table } = tabled();
    const cols = { x: new Float64Array(2) };
    m.pull([a, b], cols);
    expect([...cols.x]).toEqual([1, 10]);
    table.set(a, { x: 2 });
    table.set(b, { x: 20 });
    m.touch();
    m.pull([a, b], cols);
    expect([...cols.x]).toEqual([2, 20]);
    expect(m.probe(a)).toEqual({ x: 2, tag: undefined });
    expect(m.atRest(b)).toBe(false);
  });

  it('answers atRest for the pose as it now is', () => {
    const { m, table } = tabled();
    expect(m.atRest(a)).toBe(false);
    m.probe(a);
    table.delete(a);
    m.touch(a);
    expect(m.atRest(a)).toBe(true);
  });

  it('wakes a sleeping frame loop, until the next sync', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.cue({
      patch: patch<Part, Pose>(100, () => ({ x: 1 }), { writes: ['x'] }),
      loop: false,
      freeze: 'after',
    });
    m.sync(0);
    m.probe(a);
    m.sync(200);
    m.probe(a);
    expect(m.inert).toBe(true);
    let woke = 0;
    m.onWake(() => woke++);
    m.touch(a);
    expect(woke).toBe(1);
    expect(m.inert).toBe(false);
    m.sync(216);
    expect(m.inert).toBe(true);
  });

  it('steps no state again, and leaves a motion where it is', () => {
    let steps = 0;
    const m = mix<Part, Pose>(K, { lanes });
    m.cue({
      patch: patch<Part, Pose, { n: number }>(0, (_p, _s, setting) => ({ x: setting.state.n }), {
        writes: ['x'],
        state: () => ({ n: 0 }),
        step: (state) => {
          state.n++;
          steps++;
        },
      }),
    });
    const moving = spring<Part, { x: number }>('x', { from: 0, to: 5 });
    m.cue({ patch: moving as never });
    m.sync(0);
    m.probe(a);
    m.sync(100);
    const before = m.probe(a).x;
    const taken = steps;
    m.touch();
    expect(m.probe(a).x).toBe(before);
    m.touch(a);
    expect(m.probe(a).x).toBe(before);
    expect(steps).toBe(taken);
  });

  it('books no hit again', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const took: BookedHit[] = [];
    let host = 0;
    m.book({
      clock: () => host,
      ahead: 100,
      late: 40,
      take(item) {
        if ('hit' in item) took.push(item);
        return { stop: () => {} };
      },
    });
    m.cue({
      patch: patch<Part, Pose>(400, () => ({ x: 1 }), { writes: ['x'] }),
      start: 0,
      loop: false,
      hits: [
        { at: 0, event: 'whoosh' },
        { at: 200, event: 'clunk' },
      ],
    });
    for (host = 0; host <= 400; host += 16) {
      m.sync(host);
      m.probe(a);
      m.touch();
      m.touch(a);
    }
    expect(took.map((h) => h.event)).toEqual(['whoosh', 'clunk']);
  });
});
