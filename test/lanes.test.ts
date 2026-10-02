import { describe, expect, it } from 'vitest';
import { kit, max, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring } from '../src/motion.js';
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
 * reused out object, and requires every channel, every handle's `weightOf` for every part, probed
 * or not, and `atRest` to match.
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
        rest.push(run.m.atRest(part));
      }
      for (const part of run.parts) for (const h of run.handles) weights.push(h.weightOf(part));
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

/**
 * Runs `run` with lanes off and on; `look` probes a subject and records every given handle's
 * `weightOf` for it. Every probe and weight must match.
 */
function script(
  run: (
    m: Mix<Part, Pose>,
    parts: Part[],
    look: (part: Part, handles?: Handle<Part>[]) => void,
  ) => void,
  opts: { parts?: number } = {},
): void {
  const seen = [false, true].map((lanes) => {
    const parts = Array.from({ length: opts.parts ?? 6 }, (_, id) => ({ id }));
    const m = mix<Part, Pose>(K, { lanes });
    const poses: Pose[] = [];
    const weights: number[] = [];
    run(m, parts, (part, handles = []) => {
      poses.push(snapshot(m.probe(part)));
      for (const h of handles) weights.push(h.weightOf(part));
    });
    return { poses, weights };
  });
  const [off, on] = seen as [(typeof seen)[0], (typeof seen)[0]];
  expect(on.poses.length).toBe(off.poses.length);
  off.poses.forEach((pose, i) => {
    expectSame(pose, on.poses[i] as Pose, `probe ${i}`);
  });
  expect(on.weights, 'weightOf').toEqual(off.weights);
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

describe('lanes give the pose the general path gives', () => {
  it('for a keys voice over every subject', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse() });
      },
      { times },
    );
  });

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
      m.sync(50);
      m.probe(a);
      m.probe(b);
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
      a.seek(700);
      probe(parts[0] as Part);
      probe(parts[1] as Part);
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

describe('lanes stay identical where a fill and a probe interleave', () => {
  it('when a patch probes a subject the mix has never seen from inside a fill', () => {
    script((m, parts, look) => {
      const extra = { id: 99 };
      let asked = false;
      m.cue({ patch: pulse() });
      m.cue({
        patch: patch<Part, Pose>(
          700,
          (phase, part) => {
            if (!asked && part.id === 0) {
              asked = true;
              m.probe(extra);
            }
            return { crawl: phase + part.id };
          },
          { writes: ['crawl'] },
        ),
      });
      for (const t of times) {
        m.sync(t);
        for (const p of parts) look(p);
        look(extra);
      }
    });
  });

  it('when a patch probes another numbered subject from inside a fill', () => {
    script((m, parts, look) => {
      m.cue({ patch: pulse() });
      m.cue({
        patch: patch<Part, Pose>(
          700,
          (phase, part) => {
            const other = parts[(part.id + 1) % parts.length] as Part;
            const g = part.id === 0 ? m.probe(other).gain : 1;
            return { crawl: phase + part.id + g };
          },
          { writes: ['crawl'] },
        ),
      });
      for (const t of times) {
        m.sync(t);
        for (const p of parts) look(p);
      }
    });
  });

  it('for a fn keeping a count through setting.keep, with only some subjects probed', () => {
    const owner = {};
    script((m, parts, look) => {
      m.cue({
        patch: patch<Part, Pose>(
          500,
          (phase, _part, setting) => {
            const kept = setting.keep(owner, () => ({ n: 0 }));
            kept.n++;
            return { crawl: kept.n + phase };
          },
          { writes: ['crawl'] },
        ),
      });
      for (const t of times) {
        m.sync(t);
        for (const p of parts) if ((p.id + t) % 2 === 0) look(p);
      }
    });
  });

  it('for a fn that starts keeping state partway through, every subject probed', () => {
    const owner = {};
    script((m, parts, look) => {
      m.cue({
        patch: patch<Part, Pose>(
          1000,
          (phase, _part, setting) => {
            if (phase < 0.5) return { crawl: phase };
            const kept = setting.keep(owner, () => ({ n: 0 }));
            kept.n++;
            return { crawl: kept.n };
          },
          { writes: ['crawl'] },
        ),
      });
      for (const t of [0, 100, 200, 400, 600, 650, 700, 800, 1200, 1600]) {
        m.sync(t);
        for (const p of parts) look(p);
      }
    });
  });

  it('advances state a fn starts keeping partway through once more, for one unprobed subject', () => {
    const owner = {};
    const times = [100, 200, 400, 600, 650, 700, 800, 1200, 1600];
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 6 }, (_, id) => ({ id }));
      m.cue({
        patch: patch<Part, Pose>(
          1000,
          (phase, _part, setting) => {
            if (phase < 0.5) return { crawl: phase };
            const kept = setting.keep(owner, () => ({ n: 0 }));
            kept.n++;
            return { crawl: kept.n };
          },
          { writes: ['crawl'] },
        ),
      });
      m.sync(0);
      for (const p of parts) m.probe(p);
      // Subject 0 holds the lane's first position and is not probed again until t > 1000.
      const crawl: number[][] = [];
      for (const t of times) {
        m.sync(t);
        crawl.push(parts.map((p) => (p.id !== 0 || t > 1000 ? m.probe(p).crawl : Number.NaN)));
      }
      return crawl;
    });
    const [off, on] = runs as [number[][], number[][]];
    const ahead = new Set<number>();
    off.forEach((row, i) => {
      row.forEach((v, id) => {
        const w = (on[i] as number[])[id] as number;
        if (Number.isNaN(v)) return;
        expect(w - v, `t=${times[i]} subject ${id}`).toBeGreaterThanOrEqual(0);
        expect(w - v, `t=${times[i]} subject ${id}`).toBeLessThanOrEqual(1);
        if (w !== v) ahead.add(id);
      });
    });
    expect([...ahead]).toEqual([0]);
  });

  it('reports weightOf as of the last frame each subject was probed', () => {
    const res = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
      const h = m.cue({ patch: pulse(), fade: { in: 400 } });
      m.sync(0);
      for (const p of parts) m.probe(p);
      m.sync(100);
      for (const p of parts) m.probe(p);
      m.sync(300);
      m.probe(parts[0] as Part);
      return parts.map((p) => h.weightOf(p));
    });
    expect(res[1]).toEqual(res[0]);
  });

  it('for a voice cued mid-run with a finite loop and stagger, meeting only probed subjects', () => {
    script((m, parts, look) => {
      m.cue({ patch: pulse() });
      m.sync(0);
      for (const p of parts) look(p);
      const h = m.cue({ patch: wave(), loop: 1, stagger: (p) => p.id * 300, fade: { out: 100 } });
      for (const t of [16, 50, 120, 333, 500, 700, 900, 1000, 1500, 2000, 2600, 3000]) {
        m.sync(t);
        for (const p of parts.slice(0, 3)) look(p, [h]);
      }
    });
  });

  it('for -0 and +0 elapsed side by side in one fill', () => {
    script((m, parts, look) => {
      const h = m.cue({
        patch: patch<Part, Pose>(500, (phase) => ({ dark: phase }), { writes: ['dark'] }),
        stagger: (p) => (p.id % 2 === 0 ? 0 : -0),
        rate: -1,
      });
      m.sync(100);
      for (const p of parts) look(p);
      m.sync(150);
      h.seek(-0);
      for (const p of parts) look(p);
    });
  });

  it('for a pending voice faded before it starts', () => {
    script((m, parts, look) => {
      const a = m.cue({ patch: pulse() });
      const b = m.cue({ patch: wave(), start: 300 });
      for (const t of times) {
        m.sync(t);
        if (t === 120) b.fade({ over: 2000 });
        for (const p of parts) look(p, [a, b]);
      }
    });
  });
});

describe('lanes give motion voices the pose the general path gives', () => {
  const crawlTo = (p: Part) => 10 * p.id;

  it('for a spring over every subject, retargeted and pushed, timed and untimed, mid-flight', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', {
          from: 0,
          to: crawlTo,
          stiffness: 180,
          damping: 12,
        });
        m.cue({ patch: s, fade: { in: 50 } });
        return {
          at: (t) => {
            if (t === 120) s.to(parts[2] as Part, -40);
            if (t === 333) s.push(parts[3] as Part, 900);
            if (t === 500) s.to(parts[1] as Part, 5, 700);
            if (t === 999) s.push(parts[0] as Part, -300, 1200);
          },
        };
      },
      { times },
    );
  });

  it('for a vector spring and a glide on separate channels', () => {
    agree(
      (m, parts) => {
        const g = glide<Part, Pose>('dark', { from: 0.1, velocity: 3, ms: 250 });
        m.cue({
          patch: spring<Part, Pose, number[]>('position', {
            from: (p) => [p.id, 0, 0],
            to: [0, 5, -5],
            settle: 0,
          }),
        });
        m.cue({ patch: g });
        return {
          at: (t) => {
            if (t === 333) g.push(parts[4] as Part, -2);
            if (t === 999) g.push(parts[1] as Part, 7, 1200);
          },
        };
      },
      { times },
    );
  });

  it('for a spring per subject named with subjects, beside one over every subject', () => {
    agree(
      (m, parts) => {
        const each = parts.map((part) => spring<Part, Pose>('crawl', { from: 0, to: part.id }));
        parts.forEach((part, i) => {
          m.cue({ patch: each[i] as ReturnType<typeof spring<Part, Pose>>, subjects: [part] });
        });
        m.cue({
          patch: spring<Part, Pose>('dark', { from: crawlTo, to: 0 }),
          stagger: (p) => p.id * 40,
        });
        return {
          at: (t) => {
            if (t === 120) each[2]?.to(parts[2] as Part, -4);
            if (t === 500) each[5]?.push(parts[5] as Part, 30, 600);
          },
        };
      },
      { times },
    );
  });

  it('when only some subjects are probed, with changes waiting on unprobed ones', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', {
          from: 0,
          to: crawlTo,
          stiffness: 180,
          damping: 12,
        });
        const g = glide<Part, Pose>('dark', { from: (p) => p.id, velocity: 1 });
        m.cue({ patch: s });
        m.cue({ patch: g });
        return {
          at: (t) => {
            for (const part of parts) {
              if ((part.id + t) % 4 === 0) s.to(part, -part.id);
              if ((part.id + t) % 5 === 1) g.push(part, part.id - 3);
              if ((part.id + t) % 7 === 2) s.push(part, 50, t + 30);
            }
          },
        };
      },
      { times, parts: 12, probe: (t, part) => (part.id + Math.round(t)) % 3 !== 0 },
    );
  });

  it('for an untimed change made while its voice waits on a start, with only some probed', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: crawlTo });
        m.cue({ patch: s, start: 300 });
        return {
          at: (t) => {
            if (t === 120) for (const part of parts) s.to(part, -part.id);
          },
        };
      },
      { times, probe: (t, part) => t < 300 || (part.id + Math.round(t)) % 3 !== 0 },
    );
  });

  it('for an untimed retarget of a subject not probed last frame, read and projected', () => {
    const seen: number[][] = [];
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: 100 });
        m.cue({ patch: s, stagger: (p) => p.id * 10 });
        const out: number[] = [];
        seen.push(out);
        const b = parts[1] as Part;
        return {
          at: (t) => {
            if (t !== 200) return;
            s.to(b, -50);
            out.push((s.read(b) as { value: number }).value, m.project(100).probe(b).crawl);
          },
        };
      },
      {
        times: [0, 100, 200, 300],
        mix: { history: { ms: 2000 } },
        probe: (t, part) => !(t === 100 && part.id === 1),
      },
    );
    const [off, on] = seen as [number[], number[]];
    expect(off.length).toBe(2);
    off.forEach((v, i) => {
      expect(Object.is(v, on[i]), `value ${i}: ${v} vs ${on[i]}`).toBe(true);
    });
  });

  it('when a subject is dropped and probed again, and its number goes to another', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: crawlTo, to: 0 });
        m.cue({ patch: s });
        return {
          at: (t) => {
            if (t === 120) s.to(parts[0] as Part, 30);
            if (t === 333) m.drop(parts[0] as Part);
            if (t === 500) m.drop(parts[3] as Part);
            if (t === 999) parts.push({ id: 6 });
          },
        };
      },
      { times },
    );
  });

  it('when a spring changes between two probes of one frame', () => {
    script((m, parts, look) => {
      const s = spring<Part, Pose>('crawl', { from: 0, to: crawlTo });
      const h = m.cue({ patch: s });
      m.sync(0);
      for (const p of parts) look(p, [h]);
      m.sync(100);
      look(parts[0] as Part, [h]);
      s.to(parts[0] as Part, 50);
      s.to(parts[1] as Part, -50);
      look(parts[0] as Part, [h]);
      look(parts[1] as Part, [h]);
      look(parts[2] as Part, [h]);
      h.weight = 0.5;
      s.push(parts[2] as Part, 400);
      look(parts[0] as Part, [h]);
      look(parts[2] as Part, [h]);
      m.cue({ patch: spring<Part, Pose>('dark', { from: 1, to: 0 }) });
      look(parts[2] as Part, [h]);
      m.sync(200);
      for (const p of parts) look(p, [h]);
    });
  });

  it('under history, read back through projections', () => {
    const runs = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes, history: { ms: 2000 } });
      const s = spring<Part, Pose>('crawl', { from: 0, to: 100, stiffness: 180, damping: 12 });
      m.cue({ patch: s });
      const parts = Array.from({ length: 3 }, (_, id) => ({ id }));
      const out: number[] = [];
      for (const t of [0, 50, 100, 150, 200, 250]) {
        if (t === 100) s.to(parts[0] as Part, -30);
        if (t === 150) s.push(parts[1] as Part, 200, 120);
        m.sync(t);
        for (const part of parts) if (part.id !== 2 || t % 100 === 0) out.push(m.probe(part).crawl);
      }
      for (const back of [220, 120, 60])
        for (const part of parts) out.push(m.project(back).probe(part).crawl);
      return out;
    });
    const [off, on] = runs as [number[], number[]];
    expect(on.length).toBe(off.length);
    off.forEach((v, i) => {
      expect(Object.is(v, on[i]), `value ${i}: ${v} vs ${on[i]}`).toBe(true);
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
