import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  crawl: number;
}
const K = kit<Pose>({ crawl: sum() });
interface Part {
  id: string;
}
const crawl = patch<Part, Pose>(0, () => ({ crawl: 10 }), { writes: ['crawl'] });

describe.each([{ lanes: false }, { lanes: true }])('handle.rise, lanes $lanes', ({ lanes }) => {
  const a = { id: 'a' };
  const at = (m: ReturnType<typeof mix<Part, Pose>>, t: number) => {
    m.sync(t);
    return m.probe(a).crawl;
  };

  it('turns a fade out around from where it had got to, and climbs back over its own ramp', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: crawl, fade: { out: 100 } });
    expect(at(m, 0)).toBe(10);
    h.fade();
    expect(at(m, 40)).toBeCloseTo(6, 9);
    h.rise({ over: 100 });
    expect(h.state).toBe('live');
    expect(at(m, 40)).toBeCloseTo(6, 9);
    expect(at(m, 60)).toBeCloseTo(8, 9);
    expect(at(m, 80)).toBeCloseTo(10, 9);
    expect(at(m, 500)).toBe(10);
  });

  it('climbs back along the voice’s own curve, with no jump where it turns', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: crawl, fade: { out: 100, ease: 'ease-in-out' } });
    at(m, 0);
    h.fade();
    const turned = at(m, 30);
    h.rise({ over: 100 });
    expect(at(m, 30)).toBeCloseTo(turned, 9);
    // Back up the curve as far as it had come down: 30 ms to climb what 30 ms took.
    expect(at(m, 60)).toBeCloseTo(10, 9);
  });

  it('can be faded again once risen, and again climbs back', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: crawl, fade: { out: 100 } });
    at(m, 0);
    h.fade();
    at(m, 50);
    h.rise({ over: 100 });
    at(m, 100);
    h.fade();
    expect(at(m, 150)).toBeCloseTo(5, 9);
    h.rise();
    expect(at(m, 200)).toBeCloseTo(10, 9);
  });

  it('takes back a fade that waits for rest, at once', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: crawl, fade: { out: 100 } });
    at(m, 0);
    h.fade({ at: 'rest', deadline: 1000 });
    h.rise();
    expect(h.state).toBe('live');
    expect(at(m, 2000)).toBe(10);
  });

  it('does nothing to a voice that is not fading', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const h = m.cue({ patch: crawl, fade: { in: 100 } });
    at(m, 0);
    h.rise();
    expect(at(m, 50)).toBeCloseTo(5, 9);
  });

  it('climbs back at once under reduced motion', () => {
    const m = mix<Part, Pose>(K, { lanes, reduce: true });
    const h = m.cue({ patch: crawl, fade: { out: 100 } });
    at(m, 0);
    h.fade({ over: 0 });
    expect(h.state).toBe('done');
    const g = m.cue({ patch: crawl, fade: { out: 100 } });
    at(m, 10);
    g.rise();
    expect(at(m, 20)).toBe(10);
  });
});

describe('handle.rise in history', () => {
  it('reads back as the fade it turned around before the rise, and the climb after', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(K, { history: { ms: 1000 } });
    const h = m.cue({ patch: crawl, fade: { out: 100 } });
    m.sync(0);
    m.probe(a);
    h.fade();
    m.sync(40);
    m.probe(a);
    h.rise({ over: 100 });
    m.sync(70);
    m.probe(a);
    expect(m.project(20).probe(a).crawl).toBeCloseTo(8, 9);
    expect(m.project(60).probe(a).crawl).toBeCloseTo(8, 9);
  });
});
