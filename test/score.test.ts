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
      '400 orb out',
      '400 orb end',
      '400 text start',
      '400 text in',
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
      '1200 s1 out',
      '1200 s1 end',
      '1600 s2 start',
      '1600 s2 in',
      '2000 s2 out',
      '2000 s2 end',
      '2400 s3 start',
      '2400 s3 in',
    ]);
  });
});
