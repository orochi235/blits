import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Row {
  id: string;
}

const hold = (ms: number) => patch<Row, Pose>(ms, () => ({ x: 1 }), { writes: ['x'] });

const starts = (m: ReturnType<typeof mix<Row, Pose>>, name: string) =>
  m
    .marks(0, 10_000)
    .filter((e) => e.name === name && e.mark === 'start')
    .map((e) => e.timestamp);

describe('joins', () => {
  it('starts after all of its anchors, at the latest', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false });
    m.cue({ patch: hold(500), name: 'b', loop: false, start: 100 });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: { start: { all: [{ after: 'a' }, { after: 'b', by: 50 }] } },
    });
    expect(starts(m, 'c')).toEqual([650]);
  });

  it('waits while any member of all is unknown', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: { start: { all: [{ after: 'a' }, { after: 'later' }] } },
    });
    expect(starts(m, 'c')).toEqual([]);
    m.sync(100);
    m.cue({ patch: hold(400), name: 'later', loop: false });
    m.sync(101);
    expect(starts(m, 'c')).toEqual([500]);
  });

  it('starts after any of its anchors once every one is known, at the earliest', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false });
    m.cue({ patch: hold(500), name: 'b', loop: false });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: { start: { any: [{ after: 'a' }, { after: 'b' }] } },
    });
    expect(starts(m, 'c')).toEqual([300]);
  });

  it('holds any open while an unknown member could still answer earlier, until a known one passes', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: { start: { any: [{ after: 'a' }, { after: 'never' }] } },
    });
    m.sync(200);
    expect(starts(m, 'c')).toEqual([]);
    m.sync(300);
    expect(starts(m, 'c')).toEqual([300]);
  });

  it('nests, and takes an announced mark as a member', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'a', loop: false });
    m.cue({ patch: hold(200), name: 'b', loop: false });
    m.announce('landed', { at: 700 });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: {
        start: { all: [{ any: [{ after: 'a' }, { after: 'b' }] }, { with: 'landed' }] },
      },
    });
    m.sync(1);
    expect(starts(m, 'c')).toEqual([700]);
  });

  it('moves with a member whose voice leaves early, and keeps what one already gone last gave', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const a = m.cue({ patch: hold(1000), name: 'a', loop: false });
    m.cue({ patch: hold(200), name: 'b', loop: false });
    m.cue({
      patch: hold(100),
      name: 'c',
      loop: false,
      anchor: { start: { all: [{ after: 'a' }, { after: 'b' }] } },
    });
    m.cue({ patch: hold(100), name: 'd', loop: false, anchor: { start: { after: 'a' } } });
    m.sync(400);
    a.fade({ over: 0 });
    m.sync(401);
    expect(starts(m, 'c')).toEqual(starts(m, 'd'));
    expect(starts(m, 'c')).toEqual([400]);
  });

  it('refuses a join that waits on the voice itself', () => {
    const m = mix<Row, Pose>(K);
    expect(() =>
      m.cue({
        patch: hold(100),
        name: 'c',
        anchor: { start: { all: [{ after: 'a' }, { after: 'c' }] } },
      }),
    ).toThrow(/waits on itself/);
  });
});
