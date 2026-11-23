import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';
import { agree, frames, type Part, type Pose, slide } from './ways.js';

const pulse = () => patch<Part, Pose>(200, (ph) => ({ x: ph }), { writes: ['x'] });
const rise = () => patch<Part, Pose>(300, (ph, p) => ({ x: ph * (p.id + 1) }), { writes: ['x'] });

/** The lane numbers `pull` last read its list at. */
const numbers = (m: Mix<Part, Pose>) => {
  const mixer = m as unknown as { pulled: unknown[]; pulledSlots: Int32Array };
  return Array.from(mixer.pulledSlots.subarray(0, mixer.pulled.length));
};

describe('pull renumbering a list kept dense by swap-remove', () => {
  for (const over of ['none', 'sharing', 'own'] as const)
    it(`reads what a probe reads, with numbers in list order, voice over all: ${over}`, () => {
      let ordered = 0;
      agree(
        (m) => {
          const list = Array.from({ length: 24 }, (_, id) => ({ id }));
          const hs: Handle<Part>[] = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
          if (over === 'sharing') hs.push(m.cue({ patch: pulse(), loop: true }));
          if (over === 'own') hs.push(m.cue({ patch: rise(), loop: true }));
          let next = 100;
          return {
            at: (t) => {
              const f = t / 16;
              if (f < 2) return;
              // One subject leaves for good and the last takes its place, as a new one joins the end.
              const k = (f * 7) % list.length;
              m.drop(list[k] as Part);
              list[k] = list[list.length - 1] as Part;
              const p = { id: next++ };
              list[list.length - 1] = p;
              hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
            },
            read: () => list,
            handles: () => [...hs.slice(0, 6), ...hs.slice(-3)],
          };
        },
        frames(40),
        (m) => {
          const at = numbers(m);
          if (at.length === 0) return;
          if (at.every((s, i) => i === 0 || s === (at[i - 1] as number) + 1)) ordered++;
        },
      );
      expect(ordered).toBeGreaterThan(30);
    });
});

describe('pull reading a list kept in order by splice', () => {
  it('reads what a probe reads, renumbering no run of subjects the list shifted up', () => {
    const was = new Map<Mix<Part, Pose>, Map<unknown, number>>();
    let kept = 0;
    let most = 0;
    agree(
      (m) => {
        const list = Array.from({ length: 24 }, (_, id) => ({ id }));
        const hs: Handle<Part>[] = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
        let next = 100;
        return {
          at: (t) => {
            const f = t / 16;
            if (f < 2) return;
            // One subject leaves for good, those after it move up a place, and a new one joins the end.
            const k = (f * 7) % list.length;
            m.drop(list[k] as Part);
            list.splice(k, 1);
            const p = { id: next++ };
            list.push(p);
            hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
          },
          read: () => list,
          handles: () => [...hs.slice(0, 6), ...hs.slice(-3)],
        };
      },
      frames(40),
      (m) => {
        const pulled = (m as unknown as { pulled: unknown[] }).pulled;
        const at = numbers(m);
        const before = was.get(m);
        const now = new Map<unknown, number>();
        let moved = 0;
        pulled.forEach((s, i) => {
          now.set(s, at[i] as number);
          const had = before?.get(s);
          if (had === undefined) return;
          if (had === at[i]) kept++;
          else moved++;
        });
        most = Math.max(most, moved);
        was.set(m, now);
      },
    );
    expect(kept).toBeGreaterThan(0);
    // At most a couple a frame, not every subject after the gap (23 before).
    expect(most).toBeLessThanOrEqual(2);
  });
});

describe('pull after a drop frees a number renumbering hands on', () => {
  // The dropped subject's remembered position held the number the next renumber gave another.
  for (const late of [false, true])
    it(`gives the dropped subject its own values (drop ${late ? 'after' : 'before'} the probes)`, () => {
      const read = (lanes: boolean) => {
        const m = mix<Part, { x: number }>(kit({ x: sum() }), { lanes });
        const P = Array.from({ length: 13 }, (_, id) => ({ id }));
        const at = (ids: number[]) => ids.map((i) => P[i] as Part);
        m.sync(1000);
        for (const p of at([3, 8])) m.probe(p);
        m.cue({
          patch: keys<Part, { x: number }>(1000, [{ at: 0, delta: { x: 1 } }]),
          loop: true,
          subjects: at([4]),
        });
        m.pull(at([0, 2, 4, 5, 6, 7, 8]), { x: new Float64Array(7) });
        if (!late) m.drop(P[8] as Part);
        m.sync(2666);
        for (const p of at(late ? [0, 1, 2, 3, 4, 5, 8] : [0, 1, 2, 3, 4, 5])) m.probe(p);
        if (late) m.drop(P[8] as Part);
        const x = new Float64Array(9);
        m.pull(at([0, 1, 2, 3, 4, 5, 8, 10, 12]), { x });
        return Array.from(x);
      };
      expect(read(false)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
      expect(read(true)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    });
});
