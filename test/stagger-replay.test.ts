import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Mix } from '../src/types.js';

// A staggered stateful voice replayed after a seek back steps where the live run did: same count,
// same gaps, same timestamps, on frames off the `stepMs` grid. A seek into a subject's wait once
// found no copy of its record, so the replay met it again past its start, and `catchUp: 'fresh'`
// skipped the step the live run took.

interface Pose {
  n: number;
  gaps: number;
  at: number;
  v: number;
}
interface Part {
  id: number;
}
const K = kit<Pose>({ n: sum(), gaps: sum(), at: sum(), v: sum() });
const parts: Part[] = [0, 1, 2, 3, 4].map((id) => ({ id }));

const stepping = () =>
  patch<Part, Pose, Pose>(0, (_p, _s, st) => ({ ...st.state }), {
    writes: ['n', 'gaps', 'at', 'v'],
    state: () => ({ n: 0, gaps: 0, at: 0, v: 0 }),
    step: (s, dt, _subject, setting) => {
      s.n++;
      s.gaps += dt;
      s.at = setting.timestamp;
      s.v += (50 - s.v) * Math.min(1, dt / 200);
    },
  });

const probes = (m: Mix<Part, Pose>) =>
  parts.flatMap((s) => {
    const p = m.probe(s);
    return [p.n, p.gaps, p.at, p.v];
  });

/** Plays live, then for each frame up to past the last start, seeks a fresh copy back there and replays. */
function sweep(gaps: number[], lanes: boolean, catchUp: 'fresh' | undefined) {
  const frames: number[] = [];
  for (let t = 0, i = 0; t <= 500; t += gaps[i++ % gaps.length] as number) frames.push(t);
  const cueAt = frames[5] as number;
  const live = () => {
    const m = mix<Part, Pose>(K, { lanes, history: { ms: 100_000, every: 50, tape }, stepMs: 8 });
    const poses = new Map<number, number[]>();
    const mixT = new Map<number, number>();
    for (const t of frames) {
      m.sync(t);
      if (t === cueAt)
        m.cue({ name: 'staggered', patch: stepping(), stagger: (s) => s.id * 40, catchUp });
      poses.set(t, probes(m));
      mixT.set(t, m.now);
    }
    return { m, poses, mixT };
  };
  const end = frames[frames.length - 1] as number;
  for (const from of frames.filter((f) => f < cueAt + 4 * 40 + 60)) {
    const { m, poses, mixT } = live();
    m.seek(mixT.get(from) as number);
    for (const f of frames.filter((f) => f > from)) {
      m.sync(end + (f - from));
      expect(probes(m), `frame ${f} after a seek back to ${from}`).toEqual(poses.get(f));
    }
  }
}

describe('a staggered stateful voice replayed after a seek back matches the live run', () => {
  for (const catchUp of [undefined, 'fresh'] as const)
    for (const lanes of [false, true])
      for (const gaps of [[16], [17, 16, 17], [13], [11, 23]])
        it(`catching up ${catchUp ?? 'by default'}, ${lanes ? 'on' : 'off'} lanes, frames ${gaps.join('/')} ms apart`, () =>
          sweep(gaps, lanes, catchUp));
});
