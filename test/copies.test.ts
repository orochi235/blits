import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Pose {
  x: number;
}
interface Part {
  id: string;
}

describe('two copies of blits', () => {
  it('read a keys patch the other copy made, easing included', async () => {
    // A query makes a second instance of the module, as a second install of the package would.
    const path = '../src/patch.js?copy';
    const other = (await import(/* @vite-ignore */ path)) as typeof import('../src/patch.js');
    expect(other.keys).not.toBe(keys);
    const stops = [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 100 } },
    ];
    const read = (k: typeof keys) => {
      const m = mix<Part, Pose>(kit<Pose>({ x: sum() }));
      m.cue({ patch: k<Part, Pose>(1000, stops, { ease: 'ease-in' }), start: 0 });
      m.sync(500);
      return m.probe({ id: 'a' }).x;
    };
    expect(read(other.keys)).toBe(read(keys));
    expect(read(keys)).toBeLessThan(40);
  });
});
