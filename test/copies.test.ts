import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys } from '../src/patch.js';
import { release } from '../src/shared.js';

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

  it("run a spring the other copy made as a motion, on this copy's lanes, reading the same", async () => {
    const path = '../src/motion.js?copy';
    const other = (await import(/* @vite-ignore */ path)) as typeof import('../src/motion.js');
    expect(other.spring).not.toBe(spring);
    const read = (s: typeof spring) => {
      const m = mix<Part, Pose>(kit<Pose>({ x: sum() }), { lanes: true });
      const p = s<Part, Pose>('x', { from: 0, to: 100 });
      // A spring on lanes is filled from its state; one off them is asked through `at`.
      let asked = 0;
      const at = p.at.bind(p);
      p.at = (phase, subject, setting) => {
        asked++;
        return at(phase, subject, setting);
      };
      const h = m.cue({ patch: p, start: 0 });
      const a = { id: 'a' };
      const xs: number[] = [];
      for (let t = 0; t <= 400; t += 16) {
        if (t === 160) h.to(a, 40);
        m.sync(t);
        xs.push(m.probe(a).x);
      }
      return { xs, asked, read: h.read(a) };
    };
    const theirs = read(other.spring);
    const ours = read(spring);
    expect(ours.asked).toBe(0);
    expect(theirs.asked).toBe(0);
    expect(theirs.xs).toEqual(ours.xs);
    expect(theirs.read).toEqual(ours.read);
    expect(ours.read).toBeDefined();
  });

  it('know a motion by the release, so copies of different releases keep apart', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(release).toBe(pkg.version);
  });
});
