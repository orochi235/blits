import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  crawl: number;
}
const PART = kit<Pose>({ crawl: sum() });
interface Part {
  id: string;
}

// Sends a discharge each time its charge passes 1, charging at `rate` per ms: a stand-in for
// magicsmoke's process, deterministic and stateful.
const charger = (rate: number) =>
  patch<Part, Pose, { charge: number; count: number }>(0, () => ({}), {
    writes: [],
    state: () => ({ charge: 0, count: 0 }),
    step: (s, dt, _subject, setting) => {
      s.charge += rate * dt;
      while (s.charge >= 1) {
        s.charge -= 1;
        setting.send({ n: s.count++ });
      }
    },
  });

describe('events', () => {
  it('drains what step sent, earliest first, with its subject and voice, and only once', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(PART, { stepMs: 5 });
    const fast = m.cue({ patch: charger(1 / 10) });
    const slow = m.cue({ patch: charger(1 / 15) });
    m.sync(0);
    m.probe(a);
    m.probe(b);
    m.sync(30);
    m.probe(b);
    m.probe(a);
    const got = m.drain<{ n: number }>();
    expect(got.map((e) => [e.timestamp, e.subject.id, e.voice])).toEqual([
      [10, 'b', fast.id],
      [10, 'a', fast.id],
      [15, 'b', slow.id],
      [15, 'a', slow.id],
      [20, 'b', fast.id],
      [20, 'a', fast.id],
      [30, 'b', fast.id],
      [30, 'b', slow.id],
      [30, 'a', fast.id],
      [30, 'a', slow.id],
    ]);
    expect(m.drain()).toEqual([]);
  });

  it('sends the same events at the same times at any frame rate under stepMs', () => {
    const run = (fps: number): [number, number][] => {
      const m = mix<Part, Pose>(PART, { stepMs: 5 });
      m.cue({ patch: charger(1 / 7) });
      const part = { id: 'a' };
      const out: [number, number][] = [];
      for (let n = 0; n * (1000 / fps) <= 500; n++) {
        m.sync(n * (1000 / fps));
        m.probe(part);
        for (const e of m.drain<{ n: number }>()) out.push([e.timestamp, e.event.n]);
      }
      m.sync(500);
      m.probe(part);
      for (const e of m.drain<{ n: number }>()) out.push([e.timestamp, e.event.n]);
      return out;
    };
    const exact = run(200);
    expect(exact.length).toBeGreaterThan(60);
    for (const fps of [144, 120, 60, 30]) expect(run(fps)).toEqual(exact);
  });

  it('a second probe in the same frame sends nothing more', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: charger(1 / 10) });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(20);
    m.probe(part);
    m.probe(part);
    m.atRest(part);
    expect(m.drain()).toHaveLength(2);
  });
});
