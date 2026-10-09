import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import type { Handle } from '../src/types.js';

const ids = (handles: readonly Handle<Part>[]) => handles.map((h) => h.id);

interface Pose {
  crawl: number;
}
const PART = kit<Pose>({ crawl: sum() });
interface Part {
  id: string;
}

const ramp = () =>
  keys<Part, Pose>(100, [
    { at: 0, delta: { crawl: 0 } },
    { at: 1, delta: { crawl: 10 } },
  ]);

describe('mix.voices', () => {
  it('is empty for a mix with nothing cued', () => {
    expect(mix<Part, Pose>(PART).voices()).toEqual([]);
  });

  it('lists every voice by cue order, pending, live, held and fading alike', () => {
    const m = mix<Part, Pose>(PART);
    m.sync(0);
    const held = m.cue({ patch: ramp(), loop: false, freeze: 'after' });
    const fading = m.cue({ patch: ramp(), loop: true, fade: { out: 1000 } });
    const live = m.cue({ patch: ramp(), loop: true });
    const pending = m.cue({ patch: ramp(), start: 5000 });
    m.sync(200);
    fading.fade();
    m.sync(210);
    expect([held.state, fading.state, live.state, pending.state]).toEqual([
      'frozen',
      'fading',
      'live',
      'pending',
    ]);
    expect(ids(m.voices())).toEqual([held.id, fading.id, live.id, pending.id]);
    expect(m.voices().every((h, i) => h === [held, fading, live, pending][i])).toBe(true);
    expect(m.voices().map((h) => h.state)).toEqual(['frozen', 'fading', 'live', 'pending']);
  });

  it('hands back the very handles cue returned', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.sync(0);
    const cued = m.cue({ patch: ramp(), loop: true, tags: ['x'] });
    m.sync(50);
    expect(m.probe(part).crawl).toBeCloseTo(5);
    const [listed] = m.voices('x') as [Handle<Part>];
    expect(listed).toBe(cued);
    listed.weight = 0.5;
    m.sync(50);
    expect(m.probe(part).crawl).toBeCloseTo(2.5);
    expect(cued.weight).toBe(0.5);
    listed.fade({ over: 0 });
    expect(cued.state).toBe('done');
  });

  it('leaves out a voice once it is done, before and after the mix lets it go', () => {
    const m = mix<Part, Pose>(PART);
    m.sync(0);
    const once = m.cue({ patch: ramp(), loop: false, fade: { out: 0 } });
    const loop = m.cue({ patch: ramp(), loop: true });
    expect(ids(m.voices())).toEqual([once.id, loop.id]);
    m.sync(150);
    expect(once.state).toBe('done');
    expect(ids(m.voices())).toEqual([loop.id]);
    loop.fade({ over: 0 });
    expect(loop.state).toBe('done');
    expect(m.voices()).toEqual([]);
    m.sync(160);
    expect(m.voices()).toEqual([]);
  });

  it('given a tag, lists only the voices whose tags carry it', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: ramp(), tags: ['ui', 'spin'] });
    m.cue({ patch: ramp() });
    const c = m.cue({ patch: ramp(), tags: ['spin'] });
    m.cue({ patch: ramp(), tags: ['ui'] });
    expect(ids(m.voices('spin'))).toEqual([a.id, c.id]);
    expect(m.voices('none')).toEqual([]);
  });

  it('lists a blend’s handles, and a new array each call', () => {
    const m = mix<Part, Pose>(PART);
    const members = m.blend([ramp(), ramp()], () => 0.5, { tags: ['b'] });
    const first = m.voices('b');
    expect(first).toHaveLength(2);
    expect(first.every((h, i) => h === members[i])).toBe(true);
    first.pop();
    expect(m.voices('b')).toHaveLength(2);
  });
});

describe('voices leaving', () => {
  it('leaves exactly the voices still playing, a few leaving a frame or many at once', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.sync(0);
    const by = (k: number) =>
      keys<Part, Pose>(100, [
        { at: 0, delta: { crawl: k } },
        { at: 1, delta: { crawl: k } },
      ]);
    const all = Array.from({ length: 40 }, (_, k) => ({
      k,
      h: m.cue({ patch: by(k + 1), loop: true }),
    }));
    let live = all.slice();
    let t = 0;
    // Out of cue order: one, then three, then twelve in one frame.
    for (const take of [[7], [30, 2, 19], [39, 0, 5, 11, 12, 13, 22, 23, 24, 25, 26, 33]]) {
      for (const k of take) all[k]?.h.fade({ over: 0 });
      live = live.filter((v) => !take.includes(v.k));
      t += 10;
      m.sync(t);
      expect(ids(m.voices())).toEqual(live.map((v) => v.h.id));
      expect(m.probe(part).crawl).toBe(live.reduce((s, v) => s + v.k + 1, 0));
    }
  });
});

describe('a loop that is not a whole number of passes', () => {
  it.each([2.5, 0, -1, Number.NaN])('is refused: %d', (loop) => {
    type P = { x: number };
    const m = mix<string, P>(kit<P>({ x: sum() }));
    const p = keys<string, P>(100, [{ at: 0, delta: { x: 1 } }]);
    expect(() => m.cue({ patch: p, loop })).toThrow(RangeError);
  });
});
