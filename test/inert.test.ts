import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import { keys } from '../src/patch.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const part = { id: 'a' };

/** crawl 10 at the first frame, 20 at the last. */
const ramp = () =>
  keys<Part, Pose>(100, [
    { at: 0, delta: { crawl: 10 } },
    { at: 1, delta: { crawl: 20 } },
  ]);

describe('inert', () => {
  it('holds once a held voice has played out, and wakes for its fade', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, hold: 'after' });
    m.sync(0);
    m.probe(part);
    m.sync(50);
    m.probe(part);
    expect(m.inert).toBe(false);
    m.sync(5100);
    expect(m.probe(part).crawl).toBe(20);
    expect(m.inert).toBe(true);
    expect(m.live).toBe(true);
    h.fade({ over: 100 });
    expect(m.inert).toBe(false);
    m.sync(5150);
    expect(m.probe(part).crawl).toBeCloseTo(10, 9);
    expect(m.inert).toBe(false);
    m.sync(5200);
    expect(m.inert).toBe(true);
    expect(m.live).toBe(false);
  });

  it('is inert with no voices, and never while a voice loops for good', () => {
    const m = mix<Part, Pose>(PART);
    expect(m.inert).toBe(true);
    m.sync(0);
    expect(m.inert).toBe(true);
    m.cue({ patch: ramp() });
    expect(m.inert).toBe(false);
    for (const t of [10, 1000, 100_000]) {
      m.sync(t);
      m.probe(part);
      expect(m.inert).toBe(false);
    }
  });

  it('is not inert while a held voice weighs by a signal', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, hold: 'after', weight: () => 0.5 });
    m.sync(0);
    m.probe(part);
    m.sync(5000);
    m.probe(part);
    expect(m.inert).toBe(false);
  });

  it('is not inert while a voice waits to start', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, hold: 'after', start: 1000 });
    m.sync(0);
    m.probe(part);
    expect(h.state).toBe('pending');
    expect(m.inert).toBe(false);
  });

  it('is not inert while a held voice fades in', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, hold: 'after', fade: { in: 500 } });
    m.sync(0);
    m.probe(part);
    m.sync(200);
    m.probe(part);
    expect(m.inert).toBe(false);
    m.sync(600);
    m.probe(part);
    expect(m.inert).toBe(true);
  });

  for (const lanes of [true, false]) {
    describe(`with lanes ${lanes ? 'on' : 'off'}`, () => {
      const play = (
        m: ReturnType<typeof mix<Part, Pose>>,
        parts: Part[],
        from: number,
        to: number,
      ) => {
        for (let t = from; t <= to; t += 16) {
          m.sync(t);
          for (const p of parts) m.probe(p);
        }
      };

      it('holds once every subject a spring has met settles, and wakes for a retarget', () => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: 100 });
        const m = mix<Part, Pose>(PART, { lanes });
        m.cue({ patch: s });
        const parts = [part, { id: 'b' }];
        play(m, parts, 0, 100);
        expect(m.inert).toBe(false);
        play(m, parts, 116, 5000);
        expect(m.probe(part).crawl).toBe(100);
        expect(m.inert).toBe(true);
        s.to(part, 50);
        expect(m.inert).toBe(false);
        m.sync(5020);
        expect(m.inert).toBe(false);
        m.probe(part);
        play(m, parts, 5036, 10_000);
        expect(m.probe(part).crawl).toBe(50);
        expect(m.inert).toBe(true);
      });

      it('wakes for a push on a glide at rest, and stays awake for a staggered subject', () => {
        const g = glide<Part, Pose>('crawl', { from: 0, velocity: 400, ms: 100 });
        const m = mix<Part, Pose>(PART, { lanes });
        const b = { id: 'b' };
        m.cue({ patch: g, stagger: (p) => (p === b ? 3000 : 0) });
        play(m, [part, b], 0, 2000);
        expect(m.inert).toBe(false);
        play(m, [part, b], 2016, 6000);
        expect(m.inert).toBe(true);
        g.push(part, 200);
        m.sync(6020);
        expect(m.inert).toBe(false);
      });

      it('holds once a tween ends', () => {
        const tw = tween<Part, Pose>('crawl', { from: 0, to: 10, ms: 200 });
        const m = mix<Part, Pose>(PART, { lanes });
        m.cue({ patch: tw });
        play(m, [part], 0, 100);
        expect(m.inert).toBe(false);
        play(m, [part], 116, 400);
        expect(m.inert).toBe(true);
      });
    });
  }
});
