import { describe, expect, it } from 'vitest';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';
import { agree, frames, hum, K, type Part, type Pose, slide } from './ways.js';

const pulse = () => patch<Part, Pose>(200, (ph) => ({ x: ph }), { writes: ['x'] });

describe('a pull leaves the chain of every subject it read linked as the mix now stands', () => {
  // Read straight after the pull: `atRest` and `weightOf` link a chain themselves.
  const versions = (m: Mix<Part, Pose>, list: readonly Part[]) => {
    const mixer = m as unknown as {
      version: number;
      chains: { get(p: Part): { version: number } | undefined };
    };
    return list.map((p) => mixer.chains.get(p)?.version === mixer.version);
  };

  it('once a voice over every subject has left, and once one naming a subject has', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const list = Array.from({ length: 6 }, (_, id) => ({ id }));
    const hs = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
    const second = m.cue({ patch: slide(list[2] as Part, 1), subjects: [list[2] as Part] });
    const over = m.cue({ patch: pulse(), loop: true });
    const cols = { x: new Float64Array(6), position: new Float64Array(12) };
    const every = list.map(() => true);
    for (let f = 0; f < 12; f++) {
      if (f === 4) over.fade({ over: 0 });
      if (f === 7) second.fade({ over: 0 });
      if (f === 9) (hs[5] as Handle<Part>).fade({ subject: list[5] as Part, over: 0 });
      m.sync(f * 16);
      m.pull(list, cols);
      expect(versions(m, list), `frame ${f}`).toEqual(every);
    }
  });
});

describe('a list pulled again reads what a probe of each subject reads', () => {
  it('as voices naming its subjects come and go', () => {
    agree((m) => {
      const list = Array.from({ length: 12 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
      return {
        at: (t) => {
          const f = t / 16;
          // One subject gains a voice and another loses one a frame, and some frames nothing moves.
          if (f % 3 === 0) return;
          const p = list[f % list.length] as Part;
          hs.push(m.cue({ patch: f % 2 === 0 ? slide(p, 1) : hum(p), subjects: [p], loop: true }));
          (hs[(f * 5) % hs.length] as Handle<Part>).fade({ over: f % 4 === 0 ? 30 : 0 });
        },
        read: () => list,
        handles: () => hs.slice(0, 16),
      };
    }, frames(40));
  });

  it('with subjects dropped while listed, swapped out of it, and others taking their numbers', () => {
    agree((m) => {
      const list = Array.from({ length: 12 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
      let next = 100;
      const join = () => {
        const p = { id: next++ };
        list.push(p);
        hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
      };
      return {
        at: (t) => {
          const f = t / 16;
          // Dropped and still listed: read again at once, under the voice that still names it.
          if (f === 3) m.drop(list[4] as Part);
          // Dropped and taken out by a swap with the last, as a new subject joins the end.
          if (f % 5 === 4) {
            const k = f % list.length;
            m.drop(list[k] as Part);
            list[k] = list[list.length - 1] as Part;
            list.pop();
            join();
          }
          if (f === 12) list.length = 5;
          if (f === 14) for (let i = 0; i < 9; i++) join();
          if (f === 20) list.reverse();
        },
        read: () => list,
        handles: () => hs.slice(0, 14),
      };
    }, frames(30));
  });

  it('with one subject faded out of a voice, a voice over every subject, and probes between', () => {
    agree((m) => {
      const list = Array.from({ length: 8 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = [];
      for (const p of list) {
        hs.push(m.cue({ patch: slide(p, 0), subjects: [p] }));
        hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
      }
      let over: Handle<Part> | null = null;
      return {
        at: (t) => {
          const f = t / 16;
          if (f === 2) (hs[2] as Handle<Part>).fade({ subject: list[1] as Part, over: 0 });
          if (f === 4) (hs[7] as Handle<Part>).fade({ subject: list[3] as Part, over: 40 });
          if (f === 6) over = m.cue({ patch: pulse(), loop: true });
          if (f === 9) hs.push(m.cue({ patch: hum(list[5] as Part), subjects: [list[5] as Part] }));
          if (f === 11) over?.fade({ over: 0 });
          if (f === 13) m.drop(list[1] as Part);
        },
        // A probe ahead of the pull relinks its subject first.
        synced: (t) => {
          const f = t / 16;
          if (f === 2 || f === 6 || f === 9 || f === 13) m.probe(list[f % 2 === 0 ? 1 : 5] as Part);
        },
        read: () => list,
        handles: () => hs,
      };
    }, frames(18));
  });
});
