import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const second = patch<string, Pose>(1000, (p) => ({ x: p }), { writes: ['x'] });

describe("a handle's elapsed", () => {
  it('reads the voice clock, by its rate and seeks, and counts every pass of a loop', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: second, subjects: ['a'], rate: 2, loop: true });
    m.sync(300);
    expect(h.elapsed).toBe(600);
    m.sync(800);
    expect(h.elapsed).toBe(1600);
    h.seek(250);
    expect(h.elapsed).toBe(250);
    m.sync(900);
    expect(h.elapsed).toBe(450);
  });

  it('reads where a pending voice will start, before the first sync too', () => {
    const m = mix<string, Pose>(K);
    const early = m.cue({ patch: second, subjects: ['a'], seek: 300 });
    expect(early.elapsed).toBe(300);
    m.sync(0);
    const later = m.cue({ patch: second, subjects: ['a'], start: 500 });
    m.sync(100);
    expect(later.state).toBe('pending');
    expect(later.elapsed).toBe(0);
  });

  it("reads a voice under an owner by the voice's own clock", () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const intro = m.owns({ start: 200 });
    const h = m.cue({ patch: second, subjects: ['a'], owner: intro, start: 0 });
    m.sync(500);
    expect(h.elapsed).toBe(300);
  });

  it('is NaN once the voice is done', () => {
    const m = mix<string, Pose>(K);
    m.sync(0);
    const h = m.cue({ patch: second, subjects: ['a'] });
    m.sync(1500);
    m.sync(1516);
    expect(h.state).toBe('done');
    expect(h.elapsed).toBeNaN();
  });

  it('follows a seek of the mix back past a seek of the voice', () => {
    const m = mix<string, Pose>(K, { history: { ms: 5000, tape } });
    m.sync(0);
    const h = m.cue({ patch: second, subjects: ['a'], loop: true });
    m.sync(400);
    m.sync(500);
    h.seek(900);
    m.sync(600);
    expect(h.elapsed).toBe(1000);
    m.seek(450);
    expect(h.elapsed).toBe(450);
  });
});
