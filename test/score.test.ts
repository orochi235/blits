import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Row {
  id: string;
}

const hold = (ms: number) => patch<Row, Pose>(ms, () => ({ x: 1 }), { writes: ['x'] });
const dim = (ms: number) => patch<Row, Pose>(ms, () => ({ gain: 0.5 }), { writes: ['gain'] });

const at = (m: ReturnType<typeof mix<Row, Pose>>, from: number, to: number) =>
  m.marks(from, to).map((e) => `${e.timestamp} ${e.name ?? e.voice} ${e.mark}`);

describe('placement', () => {
  it('anchors in to a time, so the voice is fully in by it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(1000), name: 'a', fade: { in: 200 }, anchor: { in: 500 } });
    expect(at(m, 0, 600)).toEqual(['300 a start', '500 a in']);
  });

  it("plays astv's orb, its landing text and the tint, each anchored on the one before", () => {
    // An orb flies 300 ms from 100; its row's text arrives over 240 ms once it lands; the tint is
    // in when the text has arrived, holds 500 ms, then fades over 1400.
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'orb', start: 100, loop: false });
    m.cue({ patch: hold(240), name: 'text', loop: false, anchor: { start: { after: 'orb' } } });
    m.cue({
      patch: dim(0),
      name: 'tint',
      fade: { out: 1400 },
      anchor: { in: { after: 'text' }, out: { after: 'text', by: 500 } },
    });
    expect(at(m, 0, 5000)).toEqual([
      '100 orb start',
      '100 orb in',
      '400 orb coast',
      '400 orb out',
      '400 orb end',
      '400 text start',
      '400 text in',
      '640 text coast',
      '640 text out',
      '640 text end',
      '640 tint start',
      '640 tint in',
      '1140 tint out',
      '2540 tint end',
    ]);
    const r = { id: 'r' };
    m.sync(500);
    expect(m.probe(r)).toEqual({ x: 1, gain: 1 });
    m.sync(800);
    expect(m.probe(r)).toEqual({ x: 0, gain: 0.5 });
    m.sync(1840);
    expect(m.probe(r).gain).toBeCloseTo(0.75, 9);
    m.sync(2600);
    expect(m.probe(r)).toEqual({ x: 0, gain: 1 });
    expect(m.live).toBe(false);
  });

  it('waits pending until its target is cued, then follows it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const late = m.cue({ patch: hold(100), anchor: { start: { with: 'cue', by: 50 } } });
    m.sync(1000);
    expect(late.state).toBe('pending');
    m.cue({ patch: hold(100), name: 'cue', start: 1200 });
    m.sync(1240);
    expect(late.state).toBe('pending');
    m.sync(1250);
    expect(late.state).toBe('live');
  });

  it('starts partway through when its anchored mark is already past', () => {
    const m = mix<Row, Pose>(K);
    const ramp = keys<Row, Pose>(1000, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 100 } },
    ]);
    m.cue({ patch: hold(1000), name: 'early', start: 0, loop: false });
    m.sync(400);
    m.cue({ patch: ramp, anchor: { start: { with: 'early' } } });
    expect(m.probe({ id: 'r' }).x).toBeCloseTo(1 + 40, 9);
  });

  it('moves a waiting start when its target leaves early', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const first = m.cue({ patch: hold(1000), name: 'first', loop: false, fade: { out: 100 } });
    const next = m.cue({ patch: hold(100), anchor: { start: { after: 'first' } } });
    expect(at(m, 0, 2000)).toContain('1100 first end');
    m.sync(300);
    first.fade();
    m.sync(350);
    expect(next.state).toBe('pending');
    m.sync(400);
    expect(next.state).toBe('live');
  });

  it("fades out on another voice's mark, and anchors end by its own fade", () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(200), name: 'cue', start: 600 });
    const a = m.cue({ patch: dim(0), fade: { out: 100 }, anchor: { out: { with: 'cue' } } });
    const b = m.cue({ patch: dim(0), fade: { out: 100 }, anchor: { end: { with: 'cue' } } });
    m.sync(550);
    expect([a.state, b.state]).toEqual(['live', 'fading']);
    m.sync(600);
    expect([a.state, b.state]).toEqual(['fading', 'done']);
    m.sync(700);
    expect(a.state).toBe('done');
  });

  it('picks by what a voice writes, with a resolver', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: dim(0), start: 300 });
    m.cue({ patch: dim(0), start: 900 });
    m.cue({ patch: hold(0), start: 100 });
    m.cue({
      patch: hold(0),
      name: 'lead',
      fade: { in: 50 },
      anchor: { in: { before: { writes: 'gain', resolver: 'next' }, by: 200 } },
    });
    expect(at(m, 0, 200).filter((e) => e.includes('lead'))).toEqual([
      '50 lead start',
      '100 lead in',
    ]);
  });

  it('refuses a placement that waits on itself, or anchors one side twice', () => {
    const m = mix<Row, Pose>(K);
    m.cue({ patch: hold(100), name: 'a', anchor: { start: { after: 'b' } } });
    expect(() => m.cue({ patch: hold(100), name: 'b', anchor: { start: { after: 'a' } } })).toThrow(
      /itself/,
    );
    expect(() => m.cue({ patch: hold(100), anchor: { start: 0, in: 10 } })).toThrow(/not both/);
    expect(() => m.cue({ patch: hold(100), start: 0, anchor: { in: 10 } })).toThrow(/not both/);
  });

  it('lets a projection ahead play what the anchors place', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(300), name: 'orb', start: 100, loop: false });
    m.cue({ patch: dim(0), anchor: { start: { after: 'orb' } } });
    const r = { id: 'r' };
    expect(m.project(200).probe(r)).toEqual({ x: 1, gain: 1 });
    expect(m.project(500).probe(r)).toEqual({ x: 0, gain: 0.5 });
    expect(m.probe(r)).toEqual({ x: 0, gain: 1 });
  });
});

describe('marks', () => {
  it("lists what changes next for astv's steps, and leaves out what nothing has fixed", () => {
    // Each step lands at k · 800: its morph runs 400 ms, then it rests.
    const m = mix<Row, Pose>(K);
    m.sync(0);
    for (const k of [1, 2, 3])
      m.cue({ patch: hold(400), name: `s${k}`, tags: ['step'], start: k * 800, loop: false });
    m.cue({ patch: hold(500), name: 'idle' });
    expect(m.marks(900, 2500).map((e) => `${e.timestamp} ${e.name} ${e.mark}`)).toEqual([
      '1200 s1 coast',
      '1200 s1 out',
      '1200 s1 end',
      '1600 s2 start',
      '1600 s2 in',
      '2000 s2 coast',
      '2000 s2 out',
      '2000 s2 end',
      '2400 s3 start',
      '2400 s3 in',
    ]);
  });
});

describe('placement read back', () => {
  it('reads a start its anchor fixed later as it stood then', () => {
    const m = mix<Row, Pose>(K, { history: { ms: 5000 } });
    m.sync(0);
    const late = m.cue({ patch: hold(1000), anchor: { start: { with: 'cue' } } });
    const r = { id: 'r' };
    const seen = new Map<number, number>();
    for (let t = 0; t <= 1000; t += 50) {
      m.sync(t);
      if (t === 300) m.cue({ patch: dim(0), name: 'cue', start: 100 });
      seen.set(t, m.probe(r).x);
    }
    expect(late.state).toBe('live');
    for (const t of [50, 250, 300, 350, 900])
      expect([t, m.project(t).probe(r).x]).toEqual([t, seen.get(t)]);
  });
});

describe('scores', () => {
  it('keeps names apart per score, and reaches into another when a query names it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: hold(100), name: 'intro', score: 'a', start: 100, loop: false });
    m.cue({ patch: hold(100), name: 'intro', score: 'b', start: 500, loop: false });
    m.cue({ patch: hold(100), name: 'next', score: 'a', anchor: { start: { after: 'intro' } } });
    m.cue({
      patch: hold(100),
      name: 'cross',
      score: 'b',
      anchor: { start: { after: { score: 'a', name: 'intro' }, by: 50 } },
    });
    const starts = m
      .marks(0, 1000)
      .filter((e) => e.mark === 'start')
      .map((e) => `${e.timestamp} ${e.score}:${e.name}`);
    expect(starts).toEqual(['100 a:intro', '200 a:next', '250 b:cross', '500 b:intro']);
  });

  it('only refuses a placement that waits on itself in its own score', () => {
    const m = mix<Row, Pose>(K);
    m.cue({ patch: hold(100), name: 'x', score: 'a', anchor: { start: { after: 'y' } } });
    expect(() =>
      m.cue({ patch: hold(100), name: 'y', score: 'b', anchor: { start: { after: 'x' } } }),
    ).not.toThrow();
    expect(() =>
      m.cue({ patch: hold(100), name: 'y', score: 'a', anchor: { start: { after: 'x' } } }),
    ).toThrow(/itself/);
  });
});

describe('announced marks', () => {
  it('starts a voice waiting on a mark when the host announces it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const burst = m.cue({ patch: dim(0), anchor: { start: { with: 'reply' } } });
    m.sync(500);
    expect(burst.state).toBe('pending');
    m.announce('reply');
    m.sync(516);
    expect(burst.state).toBe('live');
    expect(at(m, 0, 1000)).toContain(`500 ${burst.id} start`);
  });

  it('takes an announced time ahead, lists it, and lets a read ahead see it', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: dim(0), fade: { in: 200 }, anchor: { in: { with: 'beat' } } });
    m.announce('beat', { at: 1200, tags: ['music'] });
    m.sync(16);
    const marks = m.marks(0, 2000);
    expect(marks.find((e) => e.name === 'beat')).toEqual({
      timestamp: 1200,
      mark: undefined,
      voice: undefined,
      score: undefined,
      name: 'beat',
      tags: ['music'],
    });
    const r = { id: 'r' };
    expect(m.project(900).probe(r).gain).toBe(1);
    expect(m.project(1100).probe(r).gain).toBeCloseTo(0.75, 9);
    expect(m.project(1300).probe(r).gain).toBe(0.5);
  });

  it('says held for a channel whose voice still waits on a mark nobody announced', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    m.cue({ patch: dim(0), anchor: { start: { after: 'reply' } } });
    m.cue({ patch: hold(500) });
    const r = { id: 'r' };
    m.probe(r);
    expect(m.project(1000).assess(r)).toEqual({ x: 'exact', gain: 'held' });
  });

  it('reads back only what had been announced by then', () => {
    const m = mix<Row, Pose>(K, { history: { ms: 5000 } });
    const r = { id: 'r' };
    m.sync(0);
    m.cue({ patch: dim(0), anchor: { start: { with: 'beat' } } });
    const seen = new Map<number, number>();
    for (let t = 0; t <= 1600; t += 50) {
      m.sync(t);
      if (t === 500) m.announce('beat', { at: 1000 });
      seen.set(t, m.probe(r).gain);
    }
    for (const t of [300, 600, 950, 1000, 1500])
      expect([t, m.project(t).probe(r).gain]).toEqual([t, seen.get(t)]);
  });

  it('keeps announced marks to their score', () => {
    const m = mix<Row, Pose>(K);
    m.sync(0);
    const mine = m.cue({ patch: dim(0), score: 'a', anchor: { start: { with: 'go' } } });
    m.announce('go', { score: 'b' });
    m.sync(16);
    expect(mine.state).toBe('pending');
    m.announce('go', { score: 'a' });
    m.sync(32);
    expect(mine.state).toBe('live');
  });
});

describe('an anchor to a voice that has already left, without history', () => {
  const run = (m: ReturnType<typeof mix<Row, Pose>>, from: number, to: number) => {
    for (let t = from; t <= to; t += 10) m.sync(t);
  };

  it('places it as a mix with history does, and the mix comes to rest', () => {
    const states = (history: boolean) => {
      const m = mix<Row, Pose>(K, history ? { history: { ms: 10_000 } } : {});
      m.sync(0);
      m.cue({ patch: hold(100), loop: false, name: 'a' });
      run(m, 10, 300);
      const b = m.cue({ patch: hold(500), loop: false, anchor: { start: { after: 'a' } } });
      const seen: string[] = [];
      for (let t = 310; t <= 900; t += 100) {
        m.sync(t);
        seen.push(b.state);
      }
      return { seen, inert: m.inert };
    };
    const without = states(false);
    expect(without).toEqual(states(true));
    expect(without.seen).toEqual(['live', 'live', 'live', 'done', 'done', 'done']);
    expect(without.inert).toBe(true);
  });

  it('reads the last to leave under a name by default, and the first when asked', () => {
    const follows = (resolver: 'last' | 'first') => {
      const m = mix<Row, Pose>(K);
      m.sync(0);
      m.cue({ patch: hold(100), loop: false, name: 'a' });
      run(m, 10, 150);
      m.cue({ patch: hold(100), loop: false, name: 'a' });
      run(m, 160, 400);
      const b = m.cue({
        patch: hold(10),
        loop: false,
        anchor: { start: { after: { name: 'a', resolver }, by: 1000 } },
      });
      let t = 400;
      while (b.state === 'pending' && t < 3000) {
        t += 10;
        m.sync(t);
      }
      return t;
    };
    // The first `a` ended at 100 and the second at 250; each follower starts 1000 ms after its own.
    expect([follows('last'), follows('first')]).toEqual([1250, 1100]);
  });

  it('keeps no more than the first and last voice under a name, however many leave', () => {
    const m = mix<Row, Pose>(K);
    let t = 0;
    m.sync(t);
    for (let i = 0; i < 200; i++) {
      m.cue({ patch: hold(10), loop: false, name: 'a', tags: ['row'] });
      for (let k = 0; k < 3; k++) {
        t += 10;
        m.sync(t);
      }
    }
    expect((m as unknown as { departed: { all: Set<unknown> } }).departed.all.size).toBe(2);
  });

  it('finds one that has left even past the reach of history', () => {
    const m = mix<Row, Pose>(K, { history: { ms: 200 } });
    m.sync(0);
    m.cue({ patch: hold(100), loop: false, name: 'a' });
    run(m, 10, 1000);
    const b = m.cue({ patch: hold(10), loop: false, anchor: { start: { after: 'a', by: 2000 } } });
    let t = 1000;
    while (b.state === 'pending' && t < 5000) {
      t += 10;
      m.sync(t);
    }
    expect(t).toBe(2100);
  });

  it("lets go of an owner's voices once the owner has left", () => {
    const m = mix<Row, Pose>(K);
    let t = 0;
    m.sync(t);
    for (let i = 0; i < 50; i++) {
      const owner = m.owns({});
      m.cue({ patch: hold(10), loop: false, name: 'child', owner });
      for (let k = 0; k < 3; k++) {
        t += 10;
        m.sync(t);
      }
      owner.fade({ over: 0 });
      for (let k = 0; k < 2; k++) {
        t += 10;
        m.sync(t);
      }
    }
    // The owners themselves stay, as first and last of their unnamed set; none of their children.
    expect(
      (m as unknown as { departed: { all: Set<unknown> } }).departed.all.size,
    ).toBeLessThanOrEqual(2);
  });
});
