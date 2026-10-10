import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Part {
  start: number;
}

describe("a motion patch's number for a subject, kept on the record", () => {
  it('is asked for again once the patch has given a number up', () => {
    const patch = tween<Part, Pose>('x', {
      from: (s) => s.start,
      to: (s) => s.start + 1,
      ms: 1000,
    });
    // Two mixes play the one patch, so a drop in one gives up a number the other's record kept.
    const one = mix<Part, Pose>(K, { lanes: false });
    const two = mix<Part, Pose>(K, { lanes: false });
    one.cue({ patch });
    two.cue({ patch });
    const a = { start: 10 };
    const b = { start: 50 };
    const c = { start: 100 };
    one.sync(0);
    two.sync(0);
    expect(one.probe(a).x).toBe(10);
    expect(one.probe(b).x).toBe(50);
    two.drop(a);
    // `c` takes the number `a` had.
    expect(one.probe(c).x).toBe(100);
    one.sync(16);
    two.sync(16);
    const x = one.probe(a).x;
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThan(11);
    expect(one.probe(b).x).toBeLessThan(51);
  });
});
