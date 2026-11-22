import { describe, expect, it } from 'vitest';
import { patch } from '../src/patch.js';
import type { Handle, Mix } from '../src/types.js';
import { agree, frames, hum, type Part, type Pose, slide } from './ways.js';

/** A `fn` keeping state, which no lane runs, on `x` or on `position`. */
const drift = (ms: number, on: 'x' | 'position' = 'x') =>
  patch<Part, Pose, { v: number }>(
    ms,
    (ph, _p, s) => {
      s.state.v = 0.5 * s.state.v + ph;
      return on === 'x' ? { x: s.state.v } : { position: [s.state.v, -s.state.v] };
    },
    { writes: [on], state: () => ({ v: 0 }) },
  );

const lanesOf = (m: Mix<Part, Pose>) => (m as unknown as { lanes: { whole: boolean } }).lanes;

/**
 * A crowd of one-subject tweens read each frame, with general-path voices cued by `at`: every read
 * must agree with lanes off, and the lanes are whole exactly when no general voice plays.
 */
function crowdWith(at: (m: Mix<Part, Pose>, f: number, list: Part[]) => Handle<Part>[]) {
  const general = new Map<Mix<Part, Pose>, Handle<Part>[]>();
  let whole = 0;
  agree(
    (m) => {
      const list = Array.from({ length: 12 }, (_, id) => ({ id }));
      const hs = list.map((p) => m.cue({ patch: slide(p, 0), subjects: [p] }));
      const mine: Handle<Part>[] = [];
      general.set(m, mine);
      return {
        at: (t) => {
          mine.push(...at(m, t / 16, list));
        },
        read: () => list,
        handles: () => [...hs.slice(0, 3), ...mine],
      };
    },
    frames(40),
    (m) => {
      const playing = (general.get(m) ?? []).some((h) => h.state !== 'done');
      expect(lanesOf(m).whole).toBe(!playing);
      if (!playing) whole++;
    },
  );
  expect(whole).toBeGreaterThan(0);
}

describe('a voice leaving the general path', () => {
  it('on a channel no other voice writes, one after another', () => {
    crowdWith((m, f, list) =>
      f === 3 || f === 15
        ? [m.cue({ patch: drift(80), subjects: [list[f % list.length] as Part] })]
        : [],
    );
  });

  it('on a channel another general voice still writes', () => {
    crowdWith((m, f, list) =>
      f === 3
        ? [m.cue({ patch: drift(80), subjects: [list[1] as Part] })]
        : f === 5
          ? [m.cue({ patch: drift(200), subjects: [list[2] as Part] })]
          : [],
    );
  });

  it('as a fitting voice on its channel is cued the frame it ends', () => {
    crowdWith((m, f, list) => {
      if (f === 3) return [m.cue({ patch: drift(80), subjects: [list[1] as Part] })];
      // The drift ends at frame 8 (128 ms), as the hum over every subject starts.
      if (f === 8) m.cue({ patch: hum(list[0] as Part), loop: true });
      return [];
    });
  });

  it("on the crowd's own channel, which it held off lanes", () => {
    crowdWith((m, f, list) =>
      f === 3 ? [m.cue({ patch: drift(80, 'position'), subjects: [list[4] as Part] })] : [],
    );
  });

  it('over every subject', () => {
    crowdWith((m, f) => (f === 3 ? [m.cue({ patch: drift(80) })] : []));
  });
});
