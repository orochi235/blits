import { describe, expect, it } from 'vitest';
import type { Lanes } from '../src/lanes.js';
import { glide } from '../src/motion.js';
import type { Handle, Mix } from '../src/types.js';
import {
  agree as agreeWith,
  frames,
  hum,
  type Part,
  type Played,
  type Pose,
  slide,
} from './ways.js';

/**
 * What `forget` reads to find a subject's rows must be what walking every crowd's rows finds: the
 * poses cannot show a row it lists and should not, until that subject is dropped.
 */
function listed(m: Mix<Part, Pose>): void {
  const lanes = (m as unknown as { lanes: Lanes<Part, Pose> }).lanes;
  const found = new Map<number, number[]>();
  for (const c of lanes.crowds)
    c.list.forEach((slot, p) => {
      if (slot < 0) return;
      const ids = found.get(slot) ?? [];
      ids.push(c.voiceAt(p).id);
      found.set(slot, ids);
    });
  for (let slot = 0; slot < lanes.cap; slot++)
    expect(lanes.placed.all(slot).sort(), `subject number ${slot}`).toEqual(
      (found.get(slot) ?? []).sort(),
    );
}

const agree = (play: (m: Mix<Part, Pose>) => Played, times: readonly number[]) =>
  agreeWith(play, times, listed);

describe('dropping a subject takes it off every crowd row placed on it', () => {
  it('with several voices naming it on one channel and another on a second', () => {
    agree((m) => {
      const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = [];
      for (const p of parts) {
        hs.push(m.cue({ patch: slide(p, 0), subjects: [p] }));
        hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
        hs.push(m.cue({ patch: hum(p), subjects: [p], loop: true }));
      }
      const fresh = { id: 9 };
      return {
        at: (t) => {
          if (t === 96) m.drop(parts[1] as Part);
          // The dropped subject's number goes to another, with a voice of its own.
          if (t === 112) hs.push(m.cue({ patch: slide(fresh, 2), subjects: [fresh] }));
          if (t === 240) m.drop(fresh);
        },
        // Its voices still name the dropped subject, and play for it again once it is read again.
        read: (t) => [
          ...parts.filter((p) => p.id !== 1 || t < 96 || t >= 192),
          ...(t >= 112 ? [fresh] : []),
        ],
        handles: () => hs,
      };
    }, frames(30));
  });

  it('after its crowd closed up over the rows departed voices left', () => {
    agree((m) => {
      const parts = Array.from({ length: 200 }, (_, id) => ({ id }));
      const hs = parts.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
      const late: Part[] = [];
      return {
        at: (t) => {
          // Enough rows empty at once that the crowd is compacted, moving every row after them.
          if (t === 48) for (let i = 0; i < 120; i++) (hs[i] as Handle<Part>).fade({ over: 0 });
          if (t === 96)
            for (const i of [130, 131, 199]) {
              m.drop(parts[i] as Part);
              const p = { id: 1000 + i };
              late.push(p);
              hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
            }
          if (t === 144) m.drop(parts[150] as Part);
        },
        read: (t) => [
          ...parts.filter((p) => t < 96 || ![130, 131, 199].includes(p.id)),
          ...(t >= 96 ? late : []),
        ],
        handles: () => [0, 130, 150, 199, 200, 202].flatMap((i) => hs[i] ?? []),
      };
    }, frames(14));
  });

  it('while few of the crowd are read, and once all of them are again', () => {
    agree((m) => {
      const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
      const hs = parts.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
      return {
        at: (t) => {
          if (t === 320) {
            m.drop(parts[0] as Part);
            m.drop(parts[7] as Part);
          }
          if (t === 480) m.drop(parts[20] as Part);
        },
        read: (t) => (t >= 64 && t < 400 ? parts.filter((p) => p.id % 20 === 0) : parts),
        handles: () => [hs[0], hs[7], hs[20], hs[21]] as Handle<Part>[],
      };
    }, frames(36));
  });

  it('after one of its voices faded it out alone', () => {
    agree((m) => {
      const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = [];
      for (const p of parts) {
        hs.push(m.cue({ patch: slide(p, 0), subjects: [p] }));
        hs.push(m.cue({ patch: slide(p, 1), subjects: [p] }));
      }
      return {
        at: (t) => {
          if (t === 48) (hs[2] as Handle<Part>).fade({ subject: parts[1] as Part, over: 0 });
          if (t === 64) (hs[5] as Handle<Part>).fade({ subject: parts[2] as Part, over: 32 });
          if (t === 128) m.drop(parts[1] as Part);
          if (t === 160) m.drop(parts[2] as Part);
        },
        read: () => parts,
        handles: () => hs,
      };
    }, frames(16));
  });

  it('after a voice off the lanes took a channel from the crowds and gave it back', () => {
    agree((m) => {
      const parts = Array.from({ length: 6 }, (_, id) => ({ id }));
      const hs: Handle<Part>[] = [];
      for (const p of parts) {
        hs.push(m.cue({ patch: slide(p, 0), subjects: [p] }));
        hs.push(m.cue({ patch: hum(p), subjects: [p], loop: true }));
      }
      let off: Handle<Part> | null = null;
      return {
        at: (t) => {
          if (t === 48)
            off = m.cue({
              patch: glide<Part, Pose, number>('x', { from: 1, velocity: 4, ms: 300 }),
              locus: 'b',
            });
          if (t === 80) m.drop(parts[2] as Part);
          if (t === 128) off?.fade({ over: 0 });
          if (t === 160) m.drop(parts[3] as Part);
          if (t === 176) m.drop(parts[2] as Part);
        },
        read: () => parts,
        handles: () => hs,
      };
    }, frames(16));
  });
});
