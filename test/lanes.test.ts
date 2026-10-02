import { describe, expect, it } from 'vitest';
import { kit, max, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  position: number[];
  opacity: number;
}
const K = kit<Pose>({
  gain: mul(),
  crawl: sum(),
  dark: max(),
  position: vec(3, sum()),
  opacity: mul({ bounds: [0, 1] }),
});
const every = Object.keys(K) as (keyof Pose)[];

interface Part {
  id: number;
}

type Played = { handles?: Handle<Part>[]; at?: (t: number) => void } | undefined;
type Play = (m: Mix<Part, Pose>, parts: Part[]) => Played;

function snapshot(pose: Pose): Pose {
  const copy = {} as Record<keyof Pose, number | number[]>;
  for (const key of every) {
    const v = pose[key];
    copy[key] = Array.isArray(v) ? [...v] : v;
  }
  return copy as unknown as Pose;
}

function expectSame(a: Pose, b: Pose, where: string): void {
  for (const key of every) {
    const x = a[key];
    const y = b[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      expect(x.length, `${where} ${key}.length`).toBe(y.length);
      x.forEach((v, i) => {
        expect(Object.is(v, y[i]), `${where} ${key}[${i}]: ${v} vs ${y[i]}`).toBe(true);
      });
    } else expect(Object.is(x, y), `${where} ${key}: ${x} vs ${y}`).toBe(true);
  }
}

/**
 * Plays one scenario on a mix with lanes off and one with them on, building it afresh for each so
 * nothing is shared. At every time it probes the parts `probe` picks, into a fresh pose and into a
 * reused out object, and requires every channel, every handle's `weightOf` and `atRest` to match.
 */
function agree(
  play: Play,
  opts: {
    times: readonly number[];
    parts?: number;
    probe?: (t: number, part: Part) => boolean;
    mix?: MixOptions;
  },
): void {
  const n = opts.parts ?? 6;
  const runs = [false, true].map((lanes) => {
    const parts = Array.from({ length: n }, (_, id) => ({ id }));
    const m = mix<Part, Pose>(K, { ...opts.mix, lanes });
    const r = play(m, parts) ?? {};
    return { m, parts, handles: r.handles ?? [], at: r.at, out: {} as Pose };
  });
  for (const t of opts.times) {
    const seen = runs.map((run) => {
      run.at?.(t);
      run.m.sync(t);
      const poses: Pose[] = [];
      const weights: number[] = [];
      const rest: boolean[] = [];
      for (const part of run.parts) {
        if (opts.probe && !opts.probe(t, part)) continue;
        poses.push(snapshot(run.m.probe(part)));
        poses.push(snapshot(run.m.probe(part, run.out)));
        for (const h of run.handles) weights.push(h.weightOf(part));
        rest.push(run.m.atRest(part));
      }
      return { poses, weights, rest };
    });
    const [off, on] = seen as [(typeof seen)[0], (typeof seen)[0]];
    off.poses.forEach((pose, i) => {
      expectSame(pose, on.poses[i] as Pose, `t=${t} probe ${i}`);
    });
    expect(on.weights, `t=${t} weightOf`).toEqual(off.weights);
    expect(on.rest, `t=${t} atRest`).toEqual(off.rest);
  }
}

const times = [0, 16, 50, 120, 333, 500, 999, 1000, 1500, 2600];

const pulse = () =>
  keys<Part, Pose>(
    1000,
    [
      { at: 0, delta: { gain: 0.1, position: [0, 0, 0], opacity: 0.2 } },
      { at: 0.4, delta: { gain: 0.9, position: [5, -2, 1], opacity: 1.4 }, ease: 'ease-in-out' },
      { at: 1, delta: { gain: 0.1, position: [0, 0, 0], opacity: 0.2 } },
    ],
    { ease: { bezier: [0.3, 0.1, 0.2, 1] } },
  );

describe('lanes give the pose the general path gives', () => {
  it('for a keys voice over every subject', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
      },
      { times },
    );
  });

  const wave = () =>
    patch<Part, Pose>(
      700,
      (phase, part) => ({
        gain: 0.2 + 0.8 * Math.abs(Math.sin(phase * Math.PI + part.id)),
        crawl: -0,
        dark: -0.25 + phase,
        position: [phase, -0, part.id],
      }),
      { writes: ['gain', 'crawl', 'dark', 'position'] },
    );

  it('for a stateless fn voice, with -0, a negative max and a mul of 0.1', () => {
    agree(
      (m) => {
        m.cue({ patch: wave() });
      },
      { times },
    );
  });

  it('for several voices folding into one channel in voice order', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), fade: { in: 200, ease: 'ease-out' } });
        m.cue({ patch: wave(), weight: 0.6 });
        m.cue({ patch: pulse(), start: 300, rate: 1.7 });
      },
      { times },
    );
  });

  it('with stagger, target and subjects', () => {
    agree(
      (m, parts) => {
        m.cue({ patch: pulse(), stagger: (p) => p.id * 90 });
        m.cue({ patch: wave(), target: (p) => p.id % 2 === 0 });
        m.cue({ patch: pulse(), subjects: [parts[1] as Part, parts[4] as Part], weight: 0.3 });
      },
      { times },
    );
  });

  it('with finite loops, fades out and a mute', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), loop: 2, fade: { in: 100, out: 250 } });
        const h = m.cue({ patch: wave(), loop: false });
        return {
          handles: [h],
          at: (t) => {
            if (t === 1500) m.mute({ over: 300 });
          },
        };
      },
      { times },
    );
  });

  it('with weight, rate, ramp and seek changed between frames', () => {
    agree(
      (m) => {
        const a = m.cue({ patch: pulse() });
        const b = m.cue({ patch: wave(), weight: 0.5 });
        return {
          handles: [a, b],
          at: (t) => {
            if (t === 120) b.weight = 0.9;
            if (t === 333) a.rate = 0.4;
            if (t === 500) a.ramp(2, 400);
            if (t === 999) a.seek(50);
          },
        };
      },
      { times },
    );
  });

  it('for a voice per subject, each targeted at its own', () => {
    agree(
      (m, parts) => {
        for (const mine of parts) m.cue({ patch: wave(), target: (p) => p === mine });
      },
      { times },
    );
  });

  it('for voices cued once every subject is numbered, one waiting on a start', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
        return {
          at: (t) => {
            if (t === 333) m.cue({ patch: wave(), stagger: (p) => p.id * 30 });
            if (t === 500) m.cue({ patch: pulse(), start: 1200, weight: 0.4 });
          },
        };
      },
      { times },
    );
  });

  it('with bounds clamping a laned channel once', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
        m.cue({ patch: pulse(), start: 200 });
      },
      { times },
    );
  });

  it('when only some subjects are probed each frame', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
        m.cue({ patch: wave() });
      },
      { times, parts: 20, probe: (t, part) => (part.id + Math.round(t)) % 3 !== 0 },
    );
  });

  it('beside a voice on the general path, which keeps its own channel', () => {
    const counter = patch<Part, Pose, { n: number }>(
      0,
      (_phase, _part, setting) => ({ crawl: setting.state.n }),
      { writes: ['crawl'], state: () => ({ n: 0 }), step: (s) => void s.n++ },
    );
    agree(
      (m) => {
        m.cue({ patch: pulse() });
        m.cue({ patch: counter });
      },
      { times },
    );
  });

  it('when a subject is dropped and its number goes to another', () => {
    agree(
      (m, parts) => {
        m.cue({ patch: pulse(), target: (p) => p.id !== 5 });
        return {
          at: (t) => {
            if (t === 500) m.drop(parts[0] as Part);
          },
        };
      },
      { times },
    );
  });

  it('when a voice is cued and another retires between two probes of one frame', () => {
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const a = { id: 0 };
      const b = { id: 1 };
      const h = m.cue({ patch: pulse() });
      m.sync(100);
      const first = m.probe(a);
      m.cue({ patch: wave() });
      h.fade({ over: 0 });
      return [first, m.probe(b), m.probe(a)];
    });
    const [off, on] = runs as [Pose[], Pose[]];
    off.forEach((pose, i) => {
      expectSame(pose, on[i] as Pose, `probe ${i}`);
    });
  });

  it('when a handle changes between two probes of one frame', () => {
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 3 }, (_, id) => ({ id }));
      const a = m.cue({ patch: pulse() });
      const b = m.cue({ patch: wave() });
      const poses: Pose[] = [];
      const weights: number[] = [];
      const probe = (part: Part) => {
        poses.push(snapshot(m.probe(part)));
        weights.push(a.weightOf(part), b.weightOf(part));
      };
      m.sync(0);
      for (const part of parts) probe(part);
      m.sync(250);
      probe(parts[0] as Part);
      a.weight = 0.3;
      probe(parts[1] as Part);
      b.rate = 2.5;
      probe(parts[2] as Part);
      a.ramp(0.5, 300);
      probe(parts[0] as Part);
      b.fade({ over: 400 });
      probe(parts[1] as Part);
      m.sync(450);
      for (const part of parts) probe(part);
      return { poses, weights };
    });
    const [off, on] = runs as [(typeof runs)[0], (typeof runs)[0]];
    off.poses.forEach((pose, i) => {
      expectSame(pose, on.poses[i] as Pose, `probe ${i}`);
    });
    expect(on.weights).toEqual(off.weights);
  });

  it('under history, for a stateless fn keeping a count, read back through a projection', () => {
    const owner = {};
    const counting = patch<Part, Pose>(
      500,
      (phase, part, setting) => {
        const kept = setting.keep(owner, () => ({ n: 0 }));
        kept.n++;
        return { crawl: kept.n + phase, gain: 0.5 + part.id / 10 };
      },
      { writes: ['crawl', 'gain'] },
    );
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes, history: { ms: 2000, every: 100 } });
      const parts = Array.from({ length: 3 }, (_, id) => ({ id }));
      m.cue({ patch: counting, stagger: (p) => p.id * 40 });
      const poses: Pose[] = [];
      for (const t of times) {
        m.sync(t);
        for (const part of parts) poses.push(snapshot(m.probe(part)));
      }
      for (const back of [2500, 1200, 700])
        for (const part of parts) poses.push(snapshot(m.project(back).probe(part)));
      return poses;
    });
    const [off, on] = runs as [Pose[], Pose[]];
    off.forEach((pose, i) => {
      expectSame(pose, on[i] as Pose, `probe ${i}`);
    });
  });

  // The general path hands a subject probed earlier in the frame its cached delta, read before the
  // seek; a refilled lane reads every subject after it.
  it.todo('when a seek moves a voice between two probes of one subject in one frame');

  it('when a dropped number goes to a new subject the voice does not reach', () => {
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 3 }, (_, id) => ({ id }));
      m.cue({ patch: pulse(), target: (p) => p.id !== 9 });
      m.sync(100);
      for (const part of parts) m.probe(part);
      m.drop(parts[0] as Part);
      m.sync(200);
      return [snapshot(m.probe({ id: 9 })), snapshot(m.probe(parts[1] as Part))];
    });
    const [off, on] = runs as [Pose[], Pose[]];
    expect(off[0]?.gain).toBe(1);
    off.forEach((pose, i) => {
      expectSame(pose, on[i] as Pose, `probe ${i}`);
    });
  });
});

describe('lanes run', () => {
  it("fill every numbered subject at the frame's first probe", () => {
    const m = mix<Part, Pose>(K);
    const seen: number[] = [];
    const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
    m.cue({
      patch: patch<Part, Pose>(
        0,
        (_ph, part) => {
          seen.push(part.id);
          return { crawl: 1 };
        },
        { writes: ['crawl'] },
      ),
    });
    m.sync(0);
    for (const part of parts) m.probe(part);
    seen.length = 0;
    m.sync(16);
    m.probe(parts[3] as Part);
    // The general path would have called the patch for subject 3 alone.
    expect(seen.sort()).toEqual([0, 1, 2, 3]);
  });
});
