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
    const held = m.cue({ patch: ramp(), loop: false, hold: 'after' });
    const fading = m.cue({ patch: ramp(), loop: true, fade: { out: 1000 } });
    const live = m.cue({ patch: ramp(), loop: true });
    const pending = m.cue({ patch: ramp(), start: 5000 });
    m.sync(200);
    fading.fade();
    m.sync(210);
    expect([held.state, fading.state, live.state, pending.state]).toEqual([
      'held',
      'fading',
      'live',
      'pending',
    ]);
    expect(ids(m.voices())).toEqual([held.id, fading.id, live.id, pending.id]);
    expect(m.voices().map((h) => h.state)).toEqual(['held', 'fading', 'live', 'pending']);
  });

  it('hands back handles that control the voice as the one cue returned does', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.sync(0);
    const cued = m.cue({ patch: ramp(), loop: true, tags: ['x'] });
    m.sync(50);
    expect(m.probe(part).crawl).toBeCloseTo(5);
    const [listed] = m.voices('x') as [Handle<Part>];
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
    expect(ids(first)).toEqual(ids(members));
    first.pop();
    expect(m.voices('b')).toHaveLength(2);
  });
});
