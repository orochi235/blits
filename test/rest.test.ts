import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const part = { id: 'a' };

const counted = () => {
  const calls = { n: 0 };
  const p = patch<Part, Pose>(
    100,
    (phase) => {
      calls.n++;
      return { crawl: 10 * phase };
    },
    { writes: ['crawl'] },
  );
  return { p, calls };
};

describe.each([true, false])('atRest after a probe, lanes %s', (lanes) => {
  it("answers from the frame's probe without calling the patch again", () => {
    const { p, calls } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.cue({ patch: p, loop: true });
    m.sync(0);
    m.atRest(part);
    for (const t of [20, 40, 60]) {
      m.sync(t);
      m.probe(part, {} as Pose);
      const before = calls.n;
      expect(m.atRest(part)).toBe(false);
      expect(calls.n).toBe(before);
    }
  });

  it('answers for the pose the probe gave, though a weight reading host input moved since', () => {
    const input = { w: 1 };
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.cue({ patch: p, loop: true, weight: () => input.w });
    m.sync(0);
    m.atRest(part);
    m.sync(50);
    m.probe(part);
    input.w = 0;
    expect(m.atRest(part)).toBe(false);
    m.sync(60);
    expect(m.atRest(part)).toBe(true);
  });

  it('folds again once a voice is cued after the probe', () => {
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    m.atRest(part);
    m.sync(0);
    m.probe(part);
    expect(m.atRest(part)).toBe(true);
    m.cue({ patch: p, loop: true, start: 0 });
    m.sync(0);
    expect(m.atRest(part)).toBe(true);
    m.sync(50);
    m.probe(part);
    m.cue({ patch: p, loop: true, start: 50 });
    expect(m.atRest(part)).toBe(false);
  });

  it('folds again once a voice is stopped, muted or reweighted after the probe', () => {
    const { p } = counted();
    const m = mix<Part, Pose>(PART, { lanes });
    const changes: ((h: ReturnType<typeof m.cue>) => void)[] = [
      (h) => h.fade({ over: 0 }),
      () => m.mute({ over: 0 }),
      (h) => {
        h.weight = 0;
      },
    ];
    m.atRest(part);
    let t = 0;
    for (const change of changes) {
      const h = m.cue({ patch: p, loop: true });
      t += 50;
      m.sync(t);
      m.probe(part);
      expect(m.atRest(part)).toBe(false);
      change(h);
      expect(m.atRest(part)).toBe(true);
      h.fade({ over: 0 });
    }
  });
});
