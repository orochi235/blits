import { type Mix, mix, type Watched, watched } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { createFrame } from '../src/frame.js';
import { KIT, type Pose, type Shell } from '../src/show.js';

const entryOf = (m: Mix<Shell, Pose>) =>
  watched()
    .entries()
    .find((e) => e.mix === (m as unknown)) as Watched<Shell, Pose>;

/** Runs `frames` frames 16 ms apart from `from`, and sums the seconds the sparks aged. */
function run(step: (now: number) => number, from: number, frames: number): number {
  let aged = 0;
  for (let f = 1; f <= frames; f++) aged += step(from + f * 16);
  return aged;
}

describe('the fireworks frame', () => {
  it("ages the sparks by the mix time each frame played, and not at all under the panel's pause", () => {
    const m = mix<Shell, Pose>(KIT, { name: 'show' });
    const step = createFrame(m);
    step(0);
    expect(run(step, 0, 10)).toBeCloseTo(0.16, 6);
    m.rate = 0.5;
    expect(run(step, 160, 10)).toBeCloseTo(0.08, 6);
    const hold = entryOf(m).hold();
    expect(run(step, 320, 10)).toBe(0);
    hold.rate = 0.25;
    expect(run(step, 480, 10)).toBeCloseTo(0.02, 6);
    hold.free();
  });

  it('leaves a hidden tab coming back out of the show', () => {
    const m = mix<Shell, Pose>(KIT, { name: 'show' });
    const step = createFrame(m);
    step(0);
    expect(step(5000)).toBe(0);
    expect(m.now).toBe(0);
  });
});
