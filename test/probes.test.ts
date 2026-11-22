import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, last, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';

interface Pose {
  crawl: number;
  at: number[];
  tag: string;
  hue: number;
}
const K = kit<Pose>({ crawl: sum(), at: vec(2, sum()), tag: last<string>(), hue: last<number>() });
// The same channels in another order, whose noter is written out anew.
const K2 = kit<Pose>({ hue: last<number>(), tag: last<string>(), at: vec(2, sum()), crawl: sum() });

interface Part {
  id: string;
}
const part = { id: 'a' };

/** Each frame's probe into the host's own object, around a `from: 'current'` voice cut in at 400. */
const frames = (lanes: boolean, k = K) => {
  const m = mix<Part, Pose>(k, { lanes, retargets: true });
  const own = m.pose();
  const read = () => {
    const p = m.probe(part, own);
    return { crawl: p.crawl, at: [...p.at], tag: p.tag };
  };
  const moving = m.cue({
    patch: keys<Part, Pose>(1000, [
      { at: 0, delta: { crawl: 0, at: [0, 0] } },
      { at: 1, delta: { crawl: 100, at: [100, -50] } },
    ]),
    loop: false,
  });
  m.cue({ patch: patch<Part, Pose>(0, () => ({ tag: 'on' }), { writes: ['tag'] }) });
  const out = [];
  m.sync(384);
  out.push(read());
  m.sync(400);
  out.push(read());
  moving.fade({ over: 0 });
  m.cue({
    patch: keys<Part, Pose>(1000, [{ at: 1, delta: { crawl: 0, at: [0, 0] } }]),
    from: 'current',
  });
  for (const t of [401, 402]) {
    m.sync(t);
    out.push(read());
  }
  return out;
};

describe('probes kept under retargets', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const lanes of [true, false])
    it(`keep an array channel's speed and a channel holding no number${lanes ? '' : ', without lanes'}`, () => {
      type Read = { crawl: number; at: number[]; tag: string };
      const [, before, a, b] = frames(lanes) as [Read, Read, Read, Read];
      expect(a.crawl - before.crawl).toBeCloseTo(0.1, 2);
      expect(b.crawl - a.crawl).toBeCloseTo(0.1, 2);
      expect((a.at[0] as number) - (before.at[0] as number)).toBeCloseTo(0.1, 2);
      expect((a.at[1] as number) - (before.at[1] as number)).toBeCloseTo(-0.05, 2);
      expect(a.tag).toBe('on');
    });

  // Last in the file: a refusal is remembered for the module's life.
  it('keep the same where Function is refused, as under a content security policy', () => {
    const allowed = frames(true);
    vi.stubGlobal('Function', function refuse() {
      throw new EvalError('refused');
    });
    expect(frames(true, K2)).toEqual(allowed);
  });
});
