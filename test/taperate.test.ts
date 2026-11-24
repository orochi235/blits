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

for (const rate of [0.75, 1.5, 1 / 3])
  it(`reads the same mix time as a mix never sought, after seeking back and returning, at mix rate ${rate}`, () => {
    const run = (seeking: boolean) => {
      const m = mix<{ id: string }, Pose>(K, { history: { ms: 2000, every: 50, tape } });
      m.sync(0);
      m.rate = rate;
      const nows: number[] = [];
      for (let t = 20; t <= 1000; t += 20) {
        if (seeking && t > 100) {
          const at = m.now;
          m.seek(at - 30);
          m.seek(at);
        }
        m.sync(t);
        nows.push(m.now);
      }
      return nows;
    };
    expect(run(true)).toEqual(run(false));
  });

// The child a queue span plays in its cue frame is done by the next while rate 0 holds the clock,
// and a call played again in that next frame must not keep it on.
for (const lanes of [true, false])
  it(`lands what waits at a call played again while rate 0 holds the clock (lanes ${lanes})`, () => {
    const m = mix<{ id: string }, Pose>(K, { lanes, history: { ms: 2000, every: 50, tape } });
    const climb = patch<{ id: string }, Pose>(400, (ph) => ({ x: 1 + ph }), { writes: ['x'] });
    const shown: number[] = [];
    let s: ReturnType<typeof m.span> | undefined;
    for (let t = 0; t <= 80; t += 16) {
      m.sync(t);
      if (t === 16) m.rate = 0;
      if (t === 32) s = m.span({ name: 's', rate: 0.5, duration: 300, order: 'queue' });
      if (t === 48 && s) m.cue({ patch: climb, owner: s });
      if (t === 64) m.cue({ patch: climb, weight: 0 });
      shown.push(m.probe(a).x);
    }
    m.seek({ frame: m.seq - 4 });
    const got: number[] = [];
    for (let h = 96; h <= 144; h += 16) {
      m.sync(h);
      got.push(m.probe(a).x);
    }
    expect(got).toEqual(shown.slice(2));
  });
