import { describe, expect, it } from 'vitest';
import { patch } from '../src/patch.js';
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
