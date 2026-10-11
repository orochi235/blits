import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Pose {
  x: number;
  gain: number;
}
const K = kit<Pose>({ x: sum(), gain: mul() });
interface Part {
  id: string;
}
const a = { id: 'a' };

// x runs 0 to 300 over 300 ms, so it reads its own voice time.
const ramp = keys<Part, Pose>(
  300,
  [
    { at: 0, delta: { x: 0 } },
    { at: 1, delta: { x: 300 } },
  ],
  { ease: 'linear' },
);
const hold = keys<Part, Pose>(200, [{ at: 0, delta: { gain: 0.5 } }]);

describe.each([true, false])('a pending voice, lanes %s', (lanes) => {
  it('sought before its start begins there, on time', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 500, loop: false });
    m.sync(100);
    h.seek(150);
    m.sync(484);
    expect(m.probe(a).x).toBe(0);
    expect(h.state).toBe('pending');
    m.sync(500);
    expect(m.probe(a).x).toBeCloseTo(150, 9);
    m.sync(600);
    expect(m.probe(a).x).toBeCloseTo(250, 9);
    m.sync(660);
    expect(m.probe(a).x).toBe(0);
    expect(h.state).toBe('done');
  });

  it('keeps its seek when the mix’s rate moves its pinned start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 400, loop: false });
    h.seek(150);
    // A start is on the host's clock, so at half speed it comes at mix time 200.
    m.rate = 0.5;
    m.sync(300);
    expect(h.state).toBe('pending');
    m.sync(400);
    expect(m.probe(a).x).toBeCloseTo(150, 9);
    m.sync(600);
    expect(m.probe(a).x).toBeCloseTo(250, 9);
  });

  it('keeps its seek while an anchor has yet to say when it starts', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, loop: false, anchor: { start: { after: 'first' } } });
    h.seek(150);
    m.sync(100);
    m.cue({ patch: hold, name: 'first', loop: false });
    m.sync(200);
    expect(h.state).toBe('pending');
    m.sync(300);
    expect(m.probe(a).x).toBeCloseTo(150, 9);
    m.sync(400);
    expect(m.probe(a).x).toBeCloseTo(250, 9);
  });

  it('set to rate 0 starts on time and holds there until its rate is set again', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 500, loop: false, fade: { in: 100 } });
    const g = m.cue({ patch: hold, start: 500 });
    m.sync(100);
    h.rate = 0;
    g.rate = 0;
    m.sync(484);
    expect(m.probe(a).gain).toBe(1);
    m.sync(500);
    expect(h.state).toBe('live');
    expect(m.probe(a)).toEqual({ x: 0, gain: 0.5 });
    m.sync(700);
    expect(m.probe(a)).toEqual({ x: 0, gain: 0.5 });
    h.rate = 1;
    m.sync(800);
    expect(m.probe(a).x).toBeCloseTo(100, 9);
  });

  it('set to a rate with a ramp takes the ramp from its start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 500, loop: false });
    h.rate = 0;
    m.sync(100);
    h.ramp(1, 200);
    m.sync(600);
    // A rate climbing 0 to 1 over 200 ms has run 25 voice ms by halfway.
    expect(m.probe(a).x).toBeCloseTo(25, 9);
  });

  it('freezing before shows the frame it will start on, and does not play ahead of its start', () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 500, loop: false, freeze: 'before' });
    expect(m.probe(a).x).toBe(0);
    h.seek(150);
    for (const t of [100, 360, 484]) {
      m.sync(t);
      expect(m.probe(a).x, `at ${t}`).toBeCloseTo(150, 9);
    }
    m.sync(600);
    expect(m.probe(a).x).toBeCloseTo(250, 9);
  });

  it('sought past its end has played when it starts', async () => {
    const m = mix<Part, Pose>(K, { lanes });
    m.sync(0);
    const h = m.cue({ patch: ramp, start: 500, loop: false });
    h.seek(900);
    m.sync(484);
    expect(h.state).toBe('pending');
    m.sync(500);
    expect(m.probe(a).x).toBe(0);
    expect(h.state).toBe('done');
    expect(await h.played).toBe(true);
  });
});
