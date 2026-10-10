import { createHistory as tape } from '@weasel-js/history';
import { expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

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
