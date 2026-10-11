import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };

// x runs 100 to 400 over 300 ms: 100 more than its own voice time, so 0 is the voice showing nothing.
const ramp = keys<Part, Pose>(
  300,
  [
    { at: 0, delta: { x: 100 } },
    { at: 1, delta: { x: 400 } },
  ],
  { ease: 'linear' },
);
const dim = keys<Part, Pose>(100, [{ at: 0, delta: { gain: 0.5 } }]);
const passes: number[] = [];
const told = patch<Part, Pose>(
  300,
  (phase, _s, setting) => {
    passes.push(setting.pass);
    return { x: 100 + phase * 300 };
  },
  { writes: ['x'] },
);
const clock = patch<Part, Pose>(0, (_p, _s, setting) => ({ x: setting.elapsed }), {
  writes: ['x'],
});

describe.each([true, false])('a cue’s seek, lanes %s', (lanes) => {
  it('starts the voice at that position', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    m.cue({ patch: ramp, loop: false, seek: 150 });
    expect(m.probe(a).x).toBeCloseTo(250, 9);
    m.sync(100);
    expect(m.probe(a).x).toBeCloseTo(350, 9);
    m.sync(160);
    expect(m.probe(a).x).toBe(0);
  });

  it('is where a voice with a start ahead begins, as a seek on its handle is', () => {
    const read = (viaHandle: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      m.sync(0);
      const h = m.cue({ patch: ramp, loop: false, start: 200, seek: viaHandle ? undefined : 150 });
      if (viaHandle) h.seek(150);
      const out: number[] = [];
      for (let t = 100; t <= 400; t += 50) {
        m.sync(t);
        out.push(m.probe(a).x);
      }
      return out;
    };
    expect(read(false)).toEqual(read(true));
    expect(read(false).slice(0, 4)).toEqual([0, 0, 250, 300]);
  });

  it('is refused where it is no finite number', () => {
    const m = mix<Part, Pose>(K, { lanes });
    expect(() => m.cue({ patch: ramp, seek: Number.NaN })).toThrow(/seek/);
    expect(() => m.cue({ patch: ramp, seek: Number.POSITIVE_INFINITY })).toThrow(/seek/);
  });
});

describe.each([true, false])('a voice playing backward, lanes %s', (lanes) => {
  it('cued with no seek starts at its end, plays to its start and has played', async () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false, rate: -1 });
    expect(m.probe(a).x).toBeCloseTo(400, 9);
    m.sync(100);
    expect(m.probe(a).x).toBeCloseTo(300, 9);
    expect(h.state).toBe('live');
    m.sync(292);
    expect(m.probe(a).x).toBeCloseTo(108, 9);
    m.sync(308);
    expect(m.probe(a).x).toBe(0);
    expect(h.state).toBe('done');
    expect(await h.played).toBe(true);
  });

  it('cued with a seek plays back from there', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false, rate: -1, seek: 150 });
    expect(m.probe(a).x).toBeCloseTo(250, 9);
    m.sync(100);
    expect(m.probe(a).x).toBeCloseTo(150, 9);
    m.sync(160);
    expect(h.state).toBe('done');
  });

  it('of several passes starts at the end of its last', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: 2, rate: -2 });
    m.sync(50);
    expect(m.probe(a).x).toBeCloseTo(300, 9);
    m.sync(200);
    expect(m.probe(a).x).toBeCloseTo(300, 9);
    m.sync(290);
    expect(h.state).toBe('live');
    m.sync(310);
    expect(h.state).toBe('done');
  });

  it('freezing before holds its first frame once it has run back to it', async () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false, rate: -1, freeze: 'before' });
    m.sync(400);
    expect(m.probe(a).x).toBeCloseTo(100, 9);
    expect(h.state).toBe('frozen');
    expect(await h.played).toBe(true);
    m.sync(2000);
    expect(m.probe(a).x).toBeCloseTo(100, 9);
    // Set forward again from its start, it goes live and plays.
    h.seek(0);
    h.rate = 1;
    m.sync(2100);
    expect(h.state).toBe('live');
    expect(m.probe(a).x).toBeCloseTo(200, 9);
  });

  it('turned back in flight runs to its start and ends there', async () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false, fade: { out: 100 } });
    m.sync(200);
    m.probe(a);
    h.rate = -1;
    m.sync(300);
    expect(m.probe(a).x).toBeCloseTo(200, 9);
    m.sync(390);
    expect(h.state).toBe('live');
    // It reaches 0 at 400, and fades over 100 ms from there whichever frame notices.
    m.sync(450);
    expect(h.state).toBe('fading');
    expect(m.probe(a).x).toBeCloseTo(50, 9);
    m.sync(500);
    expect(h.state).toBe('done');
    expect(await h.played).toBe(true);
  });

  it('eased into reverse by a ramp through 0 turns round and ends at its start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false });
    m.sync(100);
    m.probe(a);
    // From rate 1 to -1 over 100 ms: 25 ms further on by 150, back where it was by 200.
    h.ramp(-1, 100);
    m.sync(150);
    expect(m.probe(a).x).toBeCloseTo(225, 9);
    m.sync(200);
    expect(m.probe(a).x).toBeCloseTo(200, 9);
    m.sync(250);
    expect(m.probe(a).x).toBeCloseTo(150, 9);
    m.sync(290);
    expect(h.state).toBe('live');
    m.sync(310);
    expect(h.state).toBe('done');
  });

  it('gives its marks: it coasts and ends where it reaches its start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    m.cue({ patch: ramp, loop: false, rate: -1, start: 100, name: 'back', fade: { out: 50 } });
    const next = m.cue({ patch: dim, loop: false, anchor: { start: { after: 'back' } } });
    expect(m.marks(0, 1000).map((e) => `${e.timestamp} ${e.name ?? 'next'} ${e.mark}`)).toEqual([
      '100 back start',
      '100 back in',
      '400 back coast',
      '400 back out',
      '450 back end',
      '450 next start',
      '450 next in',
      '550 next coast',
      '550 next out',
      '550 next end',
    ]);
    m.sync(440);
    expect(next.state).toBe('pending');
    m.sync(450);
    expect(next.state).toBe('live');
  });

  it('reads ahead as it will play', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    m.cue({ patch: ramp, loop: false, rate: -1, fade: { out: 100 } });
    m.probe(a);
    const ahead = [100, 250, 350].map((t) => m.project(t).probe(a).x);
    const played = [100, 250, 350].map((t) => {
      m.sync(t);
      return m.probe(a).x;
    });
    expect(ahead).toEqual(played);
    expect(played[2]).toBeCloseTo(50, 9);
  });

  it('waits for a subject staggered ahead of it before it ends', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const early = { id: 'early' };
    m.sync(0);
    const h = m.cue({
      patch: ramp,
      loop: false,
      rate: -1,
      stagger: (s) => (s.id === 'early' ? -100 : 0),
    });
    m.probe(a);
    m.probe(early);
    m.sync(350);
    expect(m.probe(a).x).toBe(0);
    expect(m.probe(early).x).toBeCloseTo(150, 9);
    expect(h.state).toBe('live');
    m.sync(410);
    expect(h.state).toBe('done');
  });
});

describe.each([true, false])('a loop for good cued backward, lanes %s', (lanes) => {
  it('starts at 0 and plays into the pass before, and the one before that', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: told, rate: -1 });
    passes.length = 0;
    expect(m.probe(a).x).toBeCloseTo(100, 9);
    m.sync(60);
    expect(m.probe(a).x).toBeCloseTo(340, 9);
    m.sync(360);
    expect(m.probe(a).x).toBeCloseTo(340, 9);
    expect(passes).toEqual([0, -1, -2]);
    m.sync(100_000);
    expect(h.state).toBe('live');
  });

  it('shows every subject from its start, whatever its stagger', () => {
    const m = mix<Part, Pose>(K, { lanes });
    const late = { id: 'late' };
    m.sync(0);
    m.cue({
      patch: told,
      rate: -1,
      fade: { in: 100 },
      stagger: (s) => (s.id === 'late' ? 90 : 0),
    });
    m.sync(100);
    expect(m.probe(a).x).toBeCloseTo(300, 9);
    expect(m.probe(late).x).toBeCloseTo(210, 9);
  });

  it('has no end for a patch with no passes either', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: clock, rate: -1 });
    m.sync(250);
    expect(m.probe(a).x).toBeCloseTo(-250, 9);
    expect(h.state).toBe('live');
  });

  it('turned back in flight, where it was cued forward, ends at its start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: told });
    m.sync(700);
    m.probe(a);
    h.rate = -1;
    m.sync(1390);
    expect(h.state).toBe('live');
    m.sync(1410);
    expect(h.state).toBe('done');
  });
});

describe('what a seek leaves alone', () => {
  it('a fade in counts from the voice’s start, not from where the seek put its clock', () => {
    for (const lanes of [true, false]) {
      const m = mix<Part, Pose>(K, { lanes });
      m.sync(0);
      m.cue({ patch: clock, seek: 5000, fade: { in: 100 } });
      m.sync(50);
      expect(m.probe(a).x, `lanes ${lanes}`).toBeCloseTo(5050 * 0.5, 9);
    }
  });

  it('a motion cued backward with no seek has ended as it starts', async () => {
    const m = mix<Part, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: tween<Part, Pose>('x', { from: 0, to: 100, ms: 200 }), rate: -1 });
    m.sync(16);
    expect(h.state).toBe('done');
    expect(await h.played).toBe(true);
  });
});
