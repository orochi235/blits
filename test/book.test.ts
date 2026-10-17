import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { BookedHit, BookOptions, Marked, Mix } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Part {
  id: string;
}
const a = { id: 'a' };
const b = { id: 'b' };
const still = patch<Part, Pose>(400, () => ({ x: 1 }), { writes: ['x'] });

interface Took {
  item: Marked | BookedHit;
  when: number;
  lateBy: number;
  canceled: boolean;
}

/** A mix with a booker on an outside clock that reads host time plus `skew`, and what it took. */
function booked(opts: Partial<BookOptions> = {}, skew = 1000) {
  const m = mix<Part, Pose>(K);
  const clock = { skew, jitter: 0 };
  let host = 0;
  const took: Took[] = [];
  const booker = m.book({
    clock: () => host + clock.skew + clock.jitter,
    ahead: 100,
    late: 40,
    take(item, when, lateBy) {
      const t: Took = { item, when, lateBy, canceled: false };
      took.push(t);
      return {
        cancel: () => {
          t.canceled = true;
        },
      };
    },
    ...opts,
  });
  const sync = (t: number) => {
    host = t;
    m.sync(t);
  };
  const run = (from: number, to: number, step = 16) => {
    for (let t = from; t <= to; t += step) sync(t);
  };
  const hits = () =>
    took
      .filter((t) => 'hit' in t.item)
      .map((t) => {
        const h = t.item as BookedHit;
        return {
          event: h.event,
          pass: h.pass,
          when: t.when,
          lateBy: t.lateBy,
          canceled: t.canceled,
        };
      });
  return { m, clock, took, booker, sync, run, hits };
}

const cue = (m: Mix<Part, Pose>, extra: object = {}) =>
  m.cue({
    patch: still,
    loop: false,
    hits: [
      { at: 0, event: 'whoosh' },
      { at: 200, event: 'clunk' },
    ],
    ...extra,
  });

describe('book', () => {
  it('books a hit once it comes within ahead, at its time on the outside clock', () => {
    const { m, sync, hits } = booked();
    cue(m);
    sync(0);
    expect(hits()).toEqual([{ event: 'whoosh', pass: 0, when: 1000, lateBy: 0, canceled: false }]);
    sync(96);
    expect(hits()).toHaveLength(1);
    sync(112);
    expect(hits()[1]).toEqual({ event: 'clunk', pass: 0, when: 1200, lateBy: 0, canceled: false });
  });

  it('books nothing twice across frames, and once per pass of a loop', () => {
    const { m, run, hits } = booked();
    cue(m, { loop: 3 });
    run(0, 2000);
    expect(hits().map((h) => [h.event, h.pass, h.when])).toEqual([
      ['whoosh', 0, 1000],
      ['clunk', 0, 1200],
      ['whoosh', 1, 1400],
      ['clunk', 1, 1600],
      ['whoosh', 2, 1800],
      ['clunk', 2, 2000],
    ]);
    expect(hits().every((h) => !h.canceled && h.lateBy === 0)).toBe(true);
  });

  it('fires a hit once per voice, not once per staggered subject', () => {
    const { m, run, hits } = booked();
    cue(m, { stagger: (s: Part) => (s === b ? 50 : 0) });
    for (let t = 0; t <= 500; t += 16) {
      run(t, t);
      m.probe(a);
      m.probe(b);
    }
    expect(hits().map((h) => h.event)).toEqual(['whoosh', 'clunk']);
  });

  it('books marks ahead, by voice and mark', () => {
    const { m, run, took } = booked();
    m.cue({ patch: still, loop: false, start: 300, name: 'late' });
    run(0, 800);
    expect(took.map((t) => [(t.item as Marked).mark, t.when, t.canceled])).toEqual([
      ['start', 1300, false],
      ['in', 1300, false],
      ['coast', 1700, false],
      ['out', 1700, false],
      ['end', 1700, false],
    ]);
  });

  it('retracts on a seek and books again where the seek put it', () => {
    const { m, sync, hits } = booked();
    const h = cue(m, { loop: 2 });
    sync(0);
    sync(112);
    expect(hits()[1]).toMatchObject({ event: 'clunk', when: 1200, canceled: false });
    h.seek(150);
    sync(128);
    // The seek was made at mix time 112, so clunk is 50 ms from there.
    expect(hits()[1]?.canceled).toBe(true);
    expect(hits()[2]).toEqual({ event: 'clunk', pass: 0, when: 1162, lateBy: 0, canceled: false });
  });

  it('retracts on a voice rate and on a mix rate', () => {
    const one = booked();
    const h = cue(one.m);
    one.sync(0);
    one.sync(112);
    h.rate = 2;
    one.sync(128);
    expect(one.hits().slice(1)).toEqual([
      { event: 'clunk', pass: 0, when: 1200, lateBy: 0, canceled: true },
      { event: 'clunk', pass: 0, when: 1156, lateBy: 0, canceled: false },
    ]);

    const two = booked();
    cue(two.m);
    two.sync(0);
    two.sync(112);
    two.m.rate = 0.5;
    two.sync(128);
    // Half speed from 112 puts clunk's remaining 88 ms at 176.
    expect(two.hits()[1]?.canceled).toBe(true);
    expect(two.hits()).toHaveLength(2);
    two.sync(224);
    expect(two.hits()[2]).toMatchObject({ event: 'clunk', when: 1288, canceled: false });
  });

  it('retracts a child’s hit on its owner’s rate and seek, and books it where they put it', () => {
    const one = booked();
    const o = one.m.owns({});
    cue(one.m, { owner: o });
    one.sync(0);
    one.sync(112);
    o.rate = 2;
    one.sync(128);
    expect(one.hits().slice(1)).toEqual([
      { event: 'clunk', pass: 0, when: 1200, lateBy: 0, canceled: true },
      { event: 'clunk', pass: 0, when: 1156, lateBy: 0, canceled: false },
    ]);

    const two = booked();
    const p = two.m.owns({});
    cue(two.m, { owner: p, loop: 2 });
    two.sync(0);
    two.sync(112);
    p.seek(150);
    two.sync(128);
    expect(two.hits()[1]?.canceled).toBe(true);
    expect(two.hits()[2]).toEqual({
      event: 'clunk',
      pass: 0,
      when: 1162,
      lateBy: 0,
      canceled: false,
    });
    expect(two.hits()).toHaveLength(3);
  });

  it('retracts what a fade takes away, and everything when the voice leaves', () => {
    const one = booked();
    const h = cue(one.m, { fade: { out: 50 } });
    one.sync(0);
    one.sync(112);
    h.fade();
    one.sync(128);
    // Faded at 112 over 50 ms, the voice is gone at 162, before clunk at 200.
    expect(one.hits()[1]?.canceled).toBe(true);

    const two = booked();
    const g = cue(two.m);
    two.sync(0);
    two.sync(112);
    g.fade();
    two.sync(128);
    expect(two.hits()[1]?.canceled).toBe(true);
    two.run(144, 600);
    expect(two.hits()).toHaveLength(2);
  });

  it('takes an item first seen past at now with lateBy, and skips one past late', () => {
    const one = booked();
    one.sync(0);
    cue(one.m, { start: -10 });
    one.sync(16);
    // The whoosh at -10 was first seen at 16.
    expect(one.hits()).toEqual([
      { event: 'whoosh', pass: 0, when: 1016, lateBy: 26, canceled: false },
    ]);

    const two = booked({ late: 40 });
    two.sync(0);
    cue(two.m, { start: -30 });
    two.sync(16);
    expect(two.hits()).toEqual([]);

    // A stalled frame: clunk at 200 falls between syncs at 50 and 230.
    const three = booked({ ahead: 50 });
    cue(three.m);
    three.sync(0);
    three.sync(50);
    three.sync(230);
    expect(three.hits()[1]).toEqual({
      event: 'clunk',
      pass: 0,
      when: 1230,
      lateBy: 30,
      canceled: false,
    });
  });

  it('smooths the outside clock and resyncs on a jump past 50 ms', () => {
    const { m, clock, sync, hits } = booked();
    cue(m);
    sync(0);
    clock.jitter = 10;
    sync(112);
    // 5% of a 10 ms residual.
    expect(hits()[1]?.when).toBeCloseTo(1200.5, 9);
    clock.jitter = 0;
    sync(128);
    expect(hits()).toHaveLength(2);
    clock.skew = 1100;
    sync(144);
    expect(hits()[1]?.canceled).toBe(true);
    expect(hits()[2]?.when).toBe(1300);
  });

  it('cancels everything ahead on cancel, and books nothing after', () => {
    const { m, booker, sync, run, hits } = booked();
    cue(m, { loop: 4 });
    sync(0);
    sync(112);
    booker.cancel();
    expect(hits().map((h) => h.canceled)).toEqual([false, true]);
    run(128, 2000);
    expect(hits()).toHaveLength(2);
  });

  it('books nothing from a projection, and splits by tag', () => {
    const { m, sync, took } = booked({ tag: 'sound' });
    cue(m);
    cue(m, { tags: ['sound'] });
    m.project(500).probe(a);
    expect(took).toEqual([]);
    sync(0);
    expect(took.every((t) => t.item.tags.includes('sound'))).toBe(true);
    expect(took.length).toBeGreaterThan(0);
  });

  it("hands a hit its voice's subjects, and none for a voice that names none", () => {
    const { m, sync, took } = booked();
    cue(m, { subjects: [a, b], hits: [{ at: 0, event: 'named' }] });
    cue(m, { hits: [{ at: 0, event: 'open' }] });
    sync(0);
    const by = new Map(
      took.map((t) => [(t.item as BookedHit).event, (t.item as BookedHit).subjects]),
    );
    expect(by.get('named')).toEqual([a, b]);
    expect(by.has('open')).toBe(true);
    expect(by.get('open')).toBeUndefined();
  });

  it('says where a host time falls on the outside clock, and the timestamp it last synced to', () => {
    const { m, booker, sync } = booked();
    expect(booker.at(0)).toBeNaN();
    expect(m.timestamp).toBeNaN();
    sync(16);
    expect(m.timestamp).toBe(16);
    expect(booker.at(16)).toBe(1016);
    expect(booker.at(66)).toBe(1066);
  });

  it('refuses a hit outside a pass', () => {
    const m = mix<Part, Pose>(K);
    expect(() => m.cue({ patch: still, hits: [{ at: 400, event: 0 }] })).toThrow(RangeError);
  });
});

describe('an owner’s hits', () => {
  it('books each once, at owner ms from its start through every clock above it', () => {
    const { m, run, took } = booked();
    const outer = m.owns({ start: 100, rate: 2 });
    const o = m.owns({
      owner: outer,
      start: 100,
      score: 'intro',
      tags: ['band'],
      hits: [
        { at: 100, event: 'downbeat' },
        { at: 300, event: 'turn' },
      ],
    });
    cue(m, { owner: o, start: 0 });
    run(0, 1000);
    const owned = took.filter((t) => 'hit' in t.item && t.item.voice === o.id);
    // On the mix: 100 + (100 + 100) / 2 = 200, and 100 + (100 + 300) / 2 = 300.
    expect(owned.map((t) => [(t.item as BookedHit).event, t.when])).toEqual([
      ['downbeat', 1200],
      ['turn', 1300],
    ]);
    expect(owned[0]?.item).toMatchObject({ pass: 0, score: 'intro', tags: ['band'] });
  });

  it('books by its own tag and score, not the voices it holds', () => {
    const { m, run, hits } = booked({ tag: 'band' });
    const o = m.owns({ tags: ['band'], hits: [{ at: 50, event: 'cymbal' }] });
    cue(m, { owner: o, start: 0 });
    run(0, 600);
    expect(hits().map((h) => h.event)).toEqual(['cymbal']);
  });

  it('books none past where it leaves', () => {
    const { m, run, hits } = booked();
    const o = m.owns({ hits: [{ at: 600, event: 'late' }] });
    cue(m, { owner: o, start: 0, hits: [] });
    run(0, 1000);
    expect(hits()).toEqual([]);
  });

  it('books none while its clock runs back, nor does a voice cued backward', () => {
    const { m, run, hits } = booked();
    const o = m.owns({ rate: -1, seek: 500, hits: [{ at: 100, event: 'owned' }] });
    cue(m, { owner: o, start: 0, hits: [] });
    cue(m, { rate: -1 });
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ x: 1 }), { writes: ['x'] }),
      rate: -1,
      seek: 300,
      hits: [{ at: 100, event: 'bare' }],
    });
    run(0, 1000);
    expect(hits()).toEqual([]);
  });

  it('refuses a hit at no time on its clock', () => {
    const m = mix<Part, Pose>(K);
    expect(() => m.owns({ hits: [{ at: -1, event: 'x' }] })).toThrow(/hit/);
    expect(() => m.owns({ hits: [{ at: Number.POSITIVE_INFINITY, event: 'x' }] })).toThrow(/hit/);
  });
});
