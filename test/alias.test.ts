import { describe, expect, it } from 'vitest';
import { kit, last, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import type { Channel, Mix } from '../src/types.js';

interface Pose {
  p: number[];
}

/** Two voices on a rest-less array channel, each holding its one stop, so `merge` returns the stop. */
function twoOnLast(opts: { lanes?: boolean } = {}): { m: Mix<object, Pose>; stops: number[][] } {
  const stops = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const m = mix<object, Pose>(kit({ p: last<number[]>() }), opts);
  for (const p of stops)
    m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p } }]), loop: true });
  return { m, stops };
}

/** A channel with a rest whose `merge` and `scale` both hand back the influence they were given. */
const replace: Channel<number[]> = {
  rest: [0, 0, 0],
  merge: (_a, b) => b,
  scale: (v) => v,
  lerp: (a, b, u) => (u < 0.5 ? a : b),
};

describe('a pose never holds a patch’s own array', () => {
  const subject = {};

  it('probe: editing the pose leaves the stops and the next frame alone', () => {
    const { m, stops } = twoOnLast();
    m.sync(0);
    const pose = m.probe(subject);
    expect(pose.p).toEqual([4, 5, 6]);
    (pose.p as number[])[0] = 99;
    expect(stops[1]).toEqual([4, 5, 6]);
    m.sync(10);
    expect(m.probe(subject).p).toEqual([4, 5, 6]);
  });

  it('probe into out: the same, and the stop is not what lands in out', () => {
    const { m, stops } = twoOnLast();
    const out = {} as Pose;
    m.sync(0);
    m.probe(subject, out);
    expect(out.p).not.toBe(stops[1]);
    out.p[0] = 99;
    m.sync(10);
    expect(m.probe(subject, out).p).toEqual([4, 5, 6]);
  });

  it('with lanes off', () => {
    const { m, stops } = twoOnLast({ lanes: false });
    m.sync(0);
    const pose = m.probe(subject);
    (pose.p as number[])[0] = 99;
    expect(stops[1]).toEqual([4, 5, 6]);
  });

  it('a projection’s probe', () => {
    const { m, stops } = twoOnLast();
    m.sync(0);
    const pose = m.project(10).probe(subject);
    (pose.p as number[])[0] = 99;
    expect(stops[1]).toEqual([4, 5, 6]);
    expect(m.project(20).probe(subject).p).toEqual([4, 5, 6]);
  });

  it('a locus folding two arrays by a lerp that hands back its second', () => {
    const stops = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const m = mix<object, Pose>(kit({ p: last<number[]>() }));
    m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p: [7, 8, 9] } }]), loop: true });
    for (const p of stops)
      m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p } }]), locus: 'x', loop: true });
    m.sync(0);
    const pose = m.probe(subject);
    (pose.p as number[])[0] = 99;
    expect(stops).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('a custom channel with rest whose merge and scale hand back the influence', () => {
    const stop = [4, 5, 6];
    const m = mix<object, Pose>(kit({ p: replace }));
    m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p: stop } }]), loop: true });
    m.sync(0);
    const pose = m.probe(subject);
    (pose.p as number[])[0] = 99;
    expect(stop).toEqual([4, 5, 6]);
  });

  it('pull copies into columns, which hold nothing of a stop', () => {
    const stop = [4, 5, 6];
    const m = mix<object, Pose>(kit({ p: replace }));
    m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p: stop } }]), loop: true });
    m.sync(0);
    const p = new Float64Array(3);
    m.pull([subject], { p });
    p[0] = 99;
    m.sync(10);
    m.pull([subject], { p });
    expect([...p]).toEqual([4, 5, 6]);
  });

  it('a stock vec channel, on lanes and off, still hands out arrays of its own', () => {
    for (const lanes of [true, false]) {
      const stop = [4, 5, 6];
      const m = mix<object, Pose>(kit({ p: vec(3, sum()) }), { lanes });
      m.cue({ patch: keys<object, Pose>(100, [{ at: 0, delta: { p: stop } }]), loop: true });
      m.sync(0);
      const pose = m.probe(subject);
      (pose.p as number[])[0] = 99;
      expect(stop).toEqual([4, 5, 6]);
    }
  });
});
