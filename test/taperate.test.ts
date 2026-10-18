import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { TapeMaker } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const a = { id: 'a' };
const flat = patch<{ id: string }, Pose>(400, () => ({ x: 7 }), { writes: ['x'] });

for (const rate of [1, 2, 0.5])
  it(`plays a call again after a seek back inside history.ms at mix rate ${rate}`, () => {
    const m = mix<{ id: string }, Pose>(K, { history: { ms: 2000, every: 50, tape } });
    const shown = new Map<number, number>();
    for (let t = 0; t <= 3500; t += 20) {
      m.sync(t);
      if (t === 0) m.rate = rate;
      if (t === 3000) m.cue({ patch: flat });
      shown.set(t, m.probe(a).x);
    }
    const now = m.now;
    // 500 ms of mix time before the cue, 1000 or less back from now.
    const back = now - (500 * rate + 500 * rate);
    m.seek(back);
    expect(m.probe(a).x).toBe(0);
    const host = 3500 - (now - back) / rate;
    for (let t = host + 20; t <= 3500; t += 20) {
      m.sync(3500 + (t - host));
      expect(m.probe(a).x, `host ${t}`).toBe(shown.get(Math.round(t)));
    }
  });

it('stamps calls in host order after a seek to the mix time rate 0 holds', () => {
  const stamps: number[] = [];
  const spy: TapeMaker = (adapter, opts) => {
    const made = tape(adapter, opts);
    return {
      ...made,
      recordEntry(ops, label) {
        stamps.push(opts.now());
        made.recordEntry(ops, label);
      },
    };
  };
  const m = mix<{ id: string }, Pose>(K, { history: { ms: 2000, every: 50, tape: spy } });
  const held = patch<{ id: string }, Pose>(0, () => ({ x: 7 }), { writes: ['x'] });
  for (let t = 0; t <= 300; t += 20) {
    m.sync(t);
    if (t === 100) m.rate = 0;
    if (t === 200) m.cue({ patch: held });
    // The mix reads 100 at every host time from 100 on: the seek stays where the host is.
    if (t === 220) m.seek(m.now);
    if (t === 240) m.cue({ patch: held });
  }
  expect(stamps).toEqual([...stamps].sort((p, q) => p - q));
  m.seek(60);
  m.seek(100);
  expect(m.probe(a).x).toBe(14);
});
