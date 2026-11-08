import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const second = patch<string, Pose>(1000, () => ({ x: 1 }), { writes: ['x'] });

describe('a voice cued before the first sync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns, naming the mix, when the first sync finds it already past its end', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mix<string, Pose>(K, { name: 'intro' });
    m.cue({ patch: second, subjects: ['a'] });
    m.sync(5000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/intro.*sync\(5000\)/);
  });

  it('stays quiet while the first sync finds it still playing, or when it was given a start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const playing = mix<string, Pose>(K);
    playing.cue({ patch: second, subjects: ['a'] });
    playing.sync(16);
    const started = mix<string, Pose>(K);
    started.cue({ patch: second, subjects: ['a'], start: 5000 });
    started.sync(5000);
    const after = mix<string, Pose>(K);
    after.sync(5000);
    after.cue({ patch: second, subjects: ['a'] });
    after.sync(6500);
    expect(warn).not.toHaveBeenCalled();
  });

  it("judges its end in mix time, by the voice's rate and seek", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slow = mix<string, Pose>(K, { name: 'slow' });
    slow.cue({ patch: second, subjects: ['a'], rate: 0.5 });
    slow.sync(1500);
    expect(slow.probe('a').x).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    const sought = mix<string, Pose>(K, { name: 'sought' });
    sought.cue({ patch: second, subjects: ['a'], seek: 900 });
    sought.sync(500);
    expect(sought.probe('a').x).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/sought.*sync\(500\)/);
  });

  it('stays quiet while a staggered subject still plays', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mix<string, Pose>(K);
    m.cue({ patch: second, subjects: ['a', 'b'], stagger: (s) => (s === 'b' ? 2000 : 0) });
    m.sync(2500);
    expect(m.probe('b').x).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
