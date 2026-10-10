import { describe, expect, it } from 'vitest';
import { kit, last, max, mul, sum, vec } from '../src/channels.js';
import { color, oklab } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { level, slew } from '../src/signals.js';
import type { Handle, Mix, MixOptions, Setting } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  position: number[];
  opacity: number;
  /** A one-axis vector, which is an array, not a number. */
  bend: number[];
  /** Rest-less: absent from a pose until some voice passes the band. */
  tint?: number[];
}
const K = kit<Pose>({
  gain: mul(),
  crawl: sum(),
  dark: max(),
  position: vec(3, sum()),
  opacity: mul({ bounds: [0, 1] }),
  bend: vec(1, sum()),
  tint: color(last()),
});
const every = Object.keys(K) as (keyof Pose)[];

interface Part {
  id: number;
}

type Played = { handles?: Handle<Part>[]; at?: (t: number) => void } | undefined;
type Play = (m: Mix<Part, Pose>, parts: Part[]) => Played;

function snapshot(pose: Pose): Pose {
  const copy = {} as Record<keyof Pose, number | number[] | undefined>;
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

/** Reads `parts` through `pull`, one pose per part, as `probe(part, out)` would give them. */
function pulled(m: Mix<Part, Pose>, parts: readonly Part[]): Pose[] {
  const k = parts.length;
  const cols = {
    gain: new Float64Array(k),
    crawl: new Float64Array(k),
    dark: new Float64Array(k),
    position: new Float64Array(k * 3),
    opacity: new Float64Array(k),
    bend: new Float64Array(k),
    tint: new Float64Array(k * 4),
  };
  m.pull(parts, cols);
  return parts.map((_, i) => ({
    gain: cols.gain[i] as number,
    crawl: cols.crawl[i] as number,
    dark: cols.dark[i] as number,
    position: [...cols.position.subarray(i * 3, i * 3 + 3)],
    opacity: cols.opacity[i] as number,
    bend: [cols.bend[i] as number],
    tint: Number.isNaN(cols.tint[i * 4] as number)
      ? undefined
      : [...cols.tint.subarray(i * 4, i * 4 + 4)],
  }));
}

/** Lanes off and on, each read through `probe` and through `pull`; the first is the reference. */
const ways = [
  { lanes: false, pull: false },
  { lanes: true, pull: false },
  { lanes: false, pull: true },
  { lanes: true, pull: true },
];

/**
 * Plays one scenario on a mix with lanes off and on, read through `probe` and through `pull`,
 * building it afresh each time so nothing is shared. At every time it reads the parts `probe`
 * picks twice: into a fresh pose, and into a reused out object or, on a `pull` run, through one
 * `pull` of them all ahead of the fresh probes. Every channel, every handle's `weightOf` for every
 * part, probed or not, `atRest` and `inert` must match the reference.
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
  const runs = ways.map((way) => {
    const parts = Array.from({ length: n }, (_, id) => ({ id }));
    const m = mix<Part, Pose>(K, { ...opts.mix, lanes: way.lanes });
    const r = play(m, parts) ?? {};
    return { ...way, m, parts, handles: r.handles ?? [], at: r.at, out: {} as Pose };
  });
  for (const t of opts.times) {
    const seen = runs.map((run) => {
      run.at?.(t);
      run.m.sync(t);
      const poses: Pose[] = [];
      const weights: number[] = [];
      const rest: boolean[] = [];
      const read = run.parts.filter((part) => !opts.probe || opts.probe(t, part));
      const fromPull = run.pull ? pulled(run.m, read) : [];
      read.forEach((part, i) => {
        poses.push(snapshot(run.m.probe(part)));
        poses.push(run.pull ? (fromPull[i] as Pose) : snapshot(run.m.probe(part, run.out)));
        rest.push(run.m.atRest(part));
      });
      for (const part of run.parts) for (const h of run.handles) weights.push(h.weightOf(part));
      return { poses, weights, rest, inert: run.m.inert };
    });
    const [ref, ...others] = seen as [(typeof seen)[0], ...(typeof seen)[0][]];
    others.forEach((other, w) => {
      const way = `lanes ${runs[w + 1]?.lanes ? 'on' : 'off'}${runs[w + 1]?.pull ? ', pull' : ''}`;
      ref.poses.forEach((pose, i) => {
        expectSame(pose, other.poses[i] as Pose, `t=${t} ${way} read ${i}`);
      });
      expect(other.weights, `t=${t} ${way} weightOf`).toEqual(ref.weights);
      expect(other.rest, `t=${t} ${way} atRest`).toEqual(ref.rest);
      expect(other.inert, `t=${t} ${way} inert`).toBe(ref.inert);
    });
  }
}

/**
 * Runs `run` with lanes off and on, read through `probe` and through `pull`; `look` reads a
 * subject and records every given handle's `weightOf` for it. On a `pull` run it pulls the subject
 * and then probes it, so the mix keeps the pose a probe keeps. Every read and weight must match.
 */
function script(
  run: (
    m: Mix<Part, Pose>,
    parts: Part[],
    look: (part: Part, handles?: Handle<Part>[]) => void,
  ) => void,
  opts: { parts?: number } = {},
): void {
  const seen = ways.map((way) => {
    const parts = Array.from({ length: opts.parts ?? 6 }, (_, id) => ({ id }));
    const m = mix<Part, Pose>(K, { lanes: way.lanes });
    const poses: Pose[] = [];
    const weights: number[] = [];
    run(m, parts, (part, handles = []) => {
      if (way.pull) {
        poses.push(pulled(m, [part])[0] as Pose);
        m.probe(part);
      } else poses.push(snapshot(m.probe(part)));
      for (const h of handles) weights.push(h.weightOf(part));
    });
    return { poses, weights };
  });
  const [ref, ...others] = seen as [(typeof seen)[0], ...(typeof seen)[0][]];
  others.forEach((other, w) => {
    const way = `lanes ${ways[w + 1]?.lanes ? 'on' : 'off'}${ways[w + 1]?.pull ? ', pull' : ''}`;
    expect(other.poses.length).toBe(ref.poses.length);
    ref.poses.forEach((pose, i) => {
      expectSame(pose, other.poses[i] as Pose, `${way} read ${i}`);
    });
    expect(other.weights, `${way} weightOf`).toEqual(ref.weights);
  });
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

  it('with holds before and after, staggered and faded in', () => {
    agree(
      (m) => {
        const a = m.cue({
          patch: pulse(),
          loop: 1,
          stagger: (p) => p.id * 90,
          fade: { in: 200 },
          freeze: 'both',
        });
        const b = m.cue({ patch: wave(), loop: 2, stagger: (p) => p.id * 40, freeze: 'after' });
        const c = m.cue({ patch: wave(), loop: 1, start: 400, weight: 0.5, freeze: 'before' });
        return {
          handles: [a, b, c],
          at: (t) => {
            if (t === 2600) a.fade({ over: 0 });
          },
        };
      },
      { times: [...times, 3000], probe: (t, p) => t !== 500 || p.id % 2 === 0 },
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

  it('with one subject faded out of a voice, at once and over a ramp, and one brought back', () => {
    const play: Play = (m, parts) => {
      const a = m.cue({ patch: pulse(), fade: { out: 200 } });
      const b = m.cue({ patch: wave(), weight: 0.5 });
      const t = tween<Part, Pose>('crawl', {
        from: 0,
        to: (p) => p.id * 10,
        ms: (p) => 200 + p.id * 50,
      });
      const c = m.cue({ patch: t });
      return {
        handles: [a, b, c],
        at: (now) => {
          if (now === 500) {
            a.fade({ subject: parts[1] as Part });
            b.fade({ subject: parts[2] as Part, over: 0 });
            c.fade({ subject: parts[3] as Part, over: 0 });
            c.fade({ subject: parts[4] as Part, over: 300 });
          }
          if (now === 1500) t.to(parts[3] as Part, -20);
        },
      };
    };
    const ramp = [0, 16, 500, 550, 650, 800, 999, 1500, 1516, 1700, 2600];
    agree(play, { times: ramp });
    agree(play, { times: ramp, parts: 80, probe: (now, p) => p.id % 7 === 0 || now > 1600 });
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
      // Subject 0 holds the lane's first position, and is probed the frame before the patch first
      // keeps state and not again until t > 1000.
      const crawl: number[][] = [];
      for (const t of times) {
        m.sync(t);
        crawl.push(
          parts.map((p) => (p.id !== 0 || t <= 400 || t > 1000 ? m.probe(p).crawl : Number.NaN)),
        );
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

  it('reports weightOf after atRest on the frame a subject meets a new lane', () => {
    const seen = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const h = m.cue({
        patch: patch<Part, Pose>(1000, (phase) => ({ crawl: phase }), { writes: ['crawl'] }),
        fade: { in: 50 },
      });
      const p = { id: 0 };
      m.sync(0);
      m.probe(p);
      m.sync(100);
      m.probe(p);
      m.cue({ patch: pulse() });
      m.atRest(p);
      return h.weightOf(p);
    });
    expect(seen[1]).toBe(seen[0]);
  });

  it('leaves a staggered subject its first call on the general path, for a fn keeping state', () => {
    script((m, parts, look) => {
      const h = m.cue({
        patch: patch<Part, Pose>(
          1000,
          (_phase, _part, setting) => {
            const kept = setting.keep(K, () => ({ n: 0 }));
            kept.n++;
            return { crawl: kept.n };
          },
          { writes: ['crawl'] },
        ),
        stagger: () => 100,
      });
      const [p, q] = parts as [Part, Part];
      m.sync(0);
      look(p, [h]);
      look(q, [h]);
      m.sync(150);
      look(q, [h]);
      m.sync(200);
      look(p, [h]);
      look(q, [h]);
    });
  });

  it('sends once per subject per frame from a stateless fn refilled between probes', () => {
    const counts = [false, true].map((lanes) => {
      const m = mix<Part, Pose>(K, { lanes });
      const h = m.cue({
        patch: patch<Part, Pose>(
          1000,
          (phase, _part, setting) => {
            setting.send('tick');
            return { crawl: phase };
          },
          { writes: ['crawl'] },
        ),
      });
      const a = { id: 0 };
      m.sync(0);
      m.probe(a);
      m.sync(16);
      m.probe(a);
      h.weight = 0.5;
      m.probe(a);
      return m.drain().length;
    });
    expect(counts[1]).toBe(counts[0]);
  });

  it('folds a vec value a fn returns as a typed array', () => {
    agree(
      (m) => {
        m.cue({
          patch: patch<Part, Pose>(
            1000,
            (phase, part) => ({
              position: Float64Array.of(phase, -part.id, 2) as unknown as number[],
            }),
            { writes: ['position'] },
          ),
        });
        m.cue({ patch: pulse() });
        return undefined;
      },
      { times },
    );
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

  it('for a tween over every subject, retargeted timed and untimed, mid-flight', () => {
    agree(
      (m, parts) => {
        const tw = tween<Part, Pose>('crawl', { from: 0, to: crawlTo, ms: 600 });
        m.cue({ patch: tw, stagger: (p) => p.id * 30 });
        return {
          at: (t) => {
            if (t === 120) tw.to(parts[2] as Part, -40);
            if (t === 500) tw.to(parts[1] as Part, 5, 700);
          },
        };
      },
      { times },
    );
  });

  for (const change of ['to', 'past', 'weight', 'rate', 'seek', 'fade', 'cue', 'drop'])
    it(`reads a tween over every subject again after a ${change} between two reads of one frame`, () => {
      script((m, parts, look) => {
        const tw = tween<Part, Pose, number[]>('position', {
          from: [0, 0, 0],
          to: (p) => [p.id, -1, 2],
          ms: 400,
          ease: 'ease-in-out',
        });
        const h = m.cue({ patch: tw, stagger: (p) => p.id * 10 });
        const [a, b, c] = parts as [Part, Part, Part];
        // A position is sampled bare from its third fill: the first numbers it in the patch.
        for (const t of [0, 16, 33]) {
          m.sync(t);
          for (const p of parts) look(p, [h]);
        }
        m.sync(100);
        look(a, [h]);
        look(b, [h]);
        if (change === 'to') tw.to(a, [9, 9, 9]);
        if (change === 'past') tw.to(a, [9, 9, 9], 50);
        if (change === 'weight') h.weight = 0.5;
        if (change === 'rate') h.rate = 3;
        if (change === 'seek') h.seek(250);
        if (change === 'fade') h.fade({ over: 0 });
        if (change === 'cue') m.cue({ patch: pulse() });
        if (change === 'drop') m.drop(c);
        look(a, [h]);
        look(b, [h]);
        look(c, [h]);
        look(a, [h]);
        m.sync(116);
        for (const p of parts) look(p, [h]);
      });
    });

  it('for a motion on fewer axes than its channel, beside one on all of them', () => {
    agree(
      (m) => {
        m.cue({
          patch: spring<Part, Pose, number[]>('position', { from: [0, 0, 0], to: [0, 0, 50] }),
        });
        m.cue({
          patch: tween<Part, Pose, number[]>('position', { from: [0, 0], to: [10, 5], ms: 200 }),
        });
      },
      { times },
    );
  });

  it('for a tween per subject named with subjects', () => {
    agree(
      (m, parts) => {
        parts.forEach((part) => {
          m.cue({
            patch: tween<Part, Pose, number[]>('position', {
              from: [part.id, 0, 0],
              to: [0, part.id, -part.id],
              ms: 300 + 50 * part.id,
              ease: { bezier: [0.3, 0, 0.2, 1] },
            }),
            subjects: [part],
            loop: false,
          });
        });
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

  it('reads an untimed push to a subject the host did not probe since', () => {
    const seen = [false, true].map((lanes) => {
      const s = spring<Part, Pose>('crawl', { from: 0, to: 100 });
      const m = mix<Part, Pose>(K, { lanes });
      m.cue({ patch: s });
      const [a, b] = [{ id: 0 }, { id: 1 }];
      for (const t of [0, 100]) {
        m.sync(t);
        m.probe(a);
        m.probe(b);
      }
      s.push(b, 2000);
      m.sync(116);
      m.probe(a);
      return s.read(b);
    });
    expect(seen[1]).toEqual(seen[0]);
  });

  it('for an untimed change on an unmet subject made after a later timed one', () => {
    script((m, parts, look) => {
      const g = glide<Part, Pose>('crawl', { from: 0, velocity: 300 });
      m.cue({ patch: g });
      const [a, b] = parts as [Part, Part];
      g.push(a, -500, 219);
      g.push(a, 900);
      m.sync(102);
      look(a);
      look(b);
      m.sync(234);
      look(b);
      m.sync(308);
      look(a);
    });
  });

  for (const history of [false, true])
    it(`seeked back past a retarget due while its subject went unprobed, history ${history}`, () => {
      const seen = [false, true].map((lanes) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: 100 });
        const m = mix<Part, Pose>(K, { lanes, history: history ? { ms: 5000 } : undefined });
        const h = m.cue({ patch: s });
        const [a, b] = [{ id: 0 }, { id: 1 }];
        for (const t of [0, 500]) {
          m.sync(t);
          m.probe(a);
          m.probe(b);
        }
        s.to(a, -50, 300);
        m.sync(600);
        m.probe(b);
        h.seek(200);
        m.sync(616);
        return [m.probe(a).crawl, m.probe(b).crawl];
      });
      expect(seen[1]).toEqual(seen[0]);
    });

  for (const steps of [
    [],
    ['seek'],
    ['fade'],
    ['seek', 'fade'],
    ['stagger'],
    ['seek', 'fade', 'stagger'],
  ])
    it(`for a past-timed retarget between two probes of one frame: ${steps.join('+') || 'plain'}`, () => {
      script((m, parts, look) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: 100 });
        const h = m.cue({ patch: s });
        if (steps.includes('stagger'))
          m.cue({
            patch: spring<Part, Pose>('crawl', { from: 0, to: 5 }),
            stagger: (p) => p.id * 50,
            weight: 0,
          });
        const [p, q] = parts as [Part, Part];
        m.sync(0);
        look(p, [h]);
        look(q);
        m.sync(100);
        look(p, [h]);
        if (steps.includes('seek')) {
          h.seek(300);
          look(p, [h]);
        }
        if (steps.includes('fade')) h.fade({ over: 45 });
        s.to(p, -40, 50);
        look(p, [h]);
        look(p, [h]);
        m.sync(116);
        look(p, [h]);
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

describe('lanes hand a channel to the general path and take it back', () => {
  const crawlTo = (p: Part) => p.id * 3;
  const drift = () =>
    patch<Part, Pose, { x: number }>(
      0,
      (_ph, _part, setting) => ({ gain: 1 + setting.state.x, crawl: setting.state.x }),
      {
        writes: ['gain', 'crawl'],
        state: () => ({ x: 0 }),
        step: (s, dt) => {
          s.x += (0.5 - s.x) * Math.min(1, dt / 400);
        },
      },
    );

  it('when a channel gains a stateful voice mid-animation and loses it again', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), fade: { in: 300 } });
        m.cue({ patch: spring<Part, Pose>('crawl', { from: 0, to: crawlTo }) });
        m.cue({ patch: wave() });
        let h: Handle<Part> | undefined;
        return {
          at: (t) => {
            if (t === 333) h = m.cue({ patch: drift() });
            if (t === 1000) h?.fade({ over: 0 });
          },
        };
      },
      { times },
    );
  });

  it('when a channel gains a voice with a signal weight and loses it again', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), loop: true });
        m.cue({ patch: spring<Part, Pose>('crawl', { from: 0, to: crawlTo }) });
        let h: Handle<Part> | undefined;
        return {
          at: (t) => {
            if (t === 120)
              h = m.cue({
                patch: wave(),
                loop: true,
                weight: (part) => 0.25 + 0.1 * part.id,
              });
            if (t === 999) h?.fade({ over: 0 });
          },
        };
      },
      { times },
    );
  });

  it('when a channel gains a voice in a locus and loses it again', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), loop: true });
        m.cue({ patch: spring<Part, Pose>('crawl', { from: 0, to: crawlTo }) });
        const hs: Handle<Part>[] = [];
        return {
          at: (t) => {
            if (t === 120) {
              hs.push(m.cue({ patch: wave(), loop: true, locus: 'a', weight: 0.6 }));
              hs.push(m.cue({ patch: pulse(), loop: true, locus: 'a', weight: 0.4 }));
            }
            if (t === 1000) for (const h of hs) h.fade({ over: 0 });
          },
        };
      },
      { times },
    );
  });

  it('when a voice starts fading to rest, which takes it off its lane', () => {
    agree(
      (m) => {
        const h = m.cue({ patch: pulse(), loop: true });
        m.cue({ patch: spring<Part, Pose>('crawl', { from: 0, to: crawlTo }) });
        return {
          handles: [h],
          at: (t) => {
            if (t === 500) h.fade({ at: 'rest', deadline: 2000 });
          },
        };
      },
      { times },
    );
  });

  it('when a spring shares the channel a voice fading to rest is leaving', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: crawlTo });
        const h = m.cue({ patch: s, fade: { in: 50, out: 200 } });
        m.cue({ patch: wave(), loop: true });
        return {
          handles: [h],
          at: (t) => {
            if (t === 120) s.to(parts[2] as Part, -40);
            if (t === 500) h.fade({ at: 'rest', deadline: 2000 });
            if (t === 999) s.push(parts[3] as Part, 700);
          },
        };
      },
      { times: [...times, 3000, 3500] },
    );
  });
});

describe('lanes go idle below a share of subjects probed and fill again above it', () => {
  // Frames 40 ms apart; the share probed runs all, 5%, all, 50%, 10%, all.
  const frames = Array.from({ length: 26 }, (_, f) => f * 40);
  const share = (t: number): number => {
    const f = t / 40;
    if (f < 4) return 1;
    if (f < 9) return 0.05;
    if (f < 13) return 1;
    if (f < 17) return 0.5;
    if (f < 21) return 0.1;
    return 1;
  };
  const probe = (t: number, part: Part) => part.id % Math.round(1 / share(t)) === 0;

  it('for keys voices with stagger and a mid-run cue', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), stagger: (p) => p.id * 7 });
        m.cue({ patch: pulse(), weight: 0.6, fade: { in: 120 } });
        return {
          at: (t) => {
            if (t === 400) m.cue({ patch: pulse(), stagger: (p) => p.id * 3, weight: 0.4 });
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for stateless fn voices with stagger and a mid-run cue', () => {
    agree(
      (m) => {
        m.cue({ patch: wave(), stagger: (p) => p.id * 5 });
        return {
          at: (t) => {
            if (t === 400) m.cue({ patch: wave(), weight: 0.5, stagger: (p) => p.id * 11 });
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a spring retargeted while idle, with a mid-run cue', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: (p) => p.id, stiffness: 120 });
        m.cue({ patch: s, stagger: (p) => p.id * 4 });
        return {
          at: (t) => {
            if (t === 240) s.to(parts[3] as Part, -20);
            if (t === 400)
              m.cue({ patch: glide<Part, Pose>('dark', { from: 0, velocity: 2, ms: 300 }) });
            if (t === 720) s.to(parts[20] as Part, 9);
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a fn voice per subject beside a keys voice over all of them', () => {
    agree(
      (m, parts) => {
        m.cue({ patch: pulse(), stagger: (p) => p.id * 4 });
        for (const part of parts.slice(0, 30)) m.cue({ patch: wave(), subjects: [part] });
        return {
          at: (t) => {
            if (t === 400) m.cue({ patch: wave(), subjects: [parts[35] as Part], weight: 0.5 });
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a keys and a fn voice on one channel, one idle while the other fills', () => {
    agree(
      (m) => {
        m.cue({ patch: pulse(), stagger: (p) => p.id * 6 });
        m.cue({ patch: wave(), weight: 0.7 });
        return {
          at: (t) => {
            if (t === 600) m.cue({ patch: pulse(), weight: 0.3 });
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('skips an idle lane and fills a busy one', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const calls: number[] = [];
    const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
    m.cue({
      patch: patch<Part, Pose>(
        0,
        (_ph, part) => {
          calls.push(part.id);
          return { crawl: 1 };
        },
        { writes: ['crawl'] },
      ),
    });
    const frame = (t: number, probed: readonly Part[]): number => {
      calls.length = 0;
      m.sync(t);
      for (const part of probed) m.probe(part);
      return calls.length;
    };
    const few = [parts[0] as Part, parts[20] as Part];
    frame(0, parts);
    frame(16, parts);
    // Every subject was probed last frame: the lane fills all 40 though 2 are probed now.
    expect(frame(32, few)).toBe(40);
    // 5% probed last frame: the lane is idle and the general path calls for the 2 probed.
    expect(frame(48, few)).toBe(2);
    // Still idle this frame, whatever is probed; then all probed last frame wakes it.
    expect(frame(64, parts)).toBe(40);
    expect(frame(80, few)).toBe(40);
  });
});

describe('lanes run', () => {
  it("fill every numbered subject at the frame's first probe", () => {
    const m = mix<Part, Pose>(K, { lanes: true });
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

describe('lanes fill only subjects probed this frame or the last', () => {
  it('leave a subject probed in neither to the general path', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const calls: number[] = [];
    const parts = Array.from({ length: 40 }, (_, id) => ({ id }));
    m.cue({
      patch: patch<Part, Pose>(
        0,
        (_ph, part) => {
          calls.push(part.id);
          return { crawl: 1 };
        },
        { writes: ['crawl'] },
      ),
    });
    const frame = (t: number, probed: readonly Part[]): number => {
      calls.length = 0;
      m.sync(t);
      for (const part of probed) m.probe(part);
      return calls.length;
    };
    const most = parts.slice(0, 30);
    frame(0, parts);
    frame(16, parts);
    expect(frame(32, most)).toBe(40);
    // 30 of 40 probed last frame keeps the lane busy: it fills those 30, and the general path
    // calls for the one probed now that was not probed then.
    expect(frame(48, [...most, parts[35] as Part])).toBe(31);
  });

  // Frames 40 ms apart; each subject is left unprobed two frames in every eight, so three
  // quarters are probed each frame, which keeps every lane busy.
  const frames = Array.from({ length: 30 }, (_, f) => f * 40);
  const probe = (t: number, part: Part) => (Math.floor(t / 80) + part.id) % 4 !== 0;

  it('for keys and fn voices with stagger, a fade and a mid-run cue', () => {
    agree(
      (m) => {
        const handles = [
          m.cue({ patch: pulse(), stagger: (p) => p.id * 7 }),
          m.cue({ patch: wave(), weight: 0.6, fade: { in: 120 } }),
        ];
        return {
          handles,
          at: (t) => {
            if (t === 400) handles.push(m.cue({ patch: pulse(), stagger: (p) => p.id * 3 }));
            if (t === 600) handles[1]?.fade({ over: 200 });
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a spring retargeted on a subject left unprobed, and a glide', () => {
    agree(
      (m, parts) => {
        const s = spring<Part, Pose>('crawl', { from: 0, to: (p) => p.id, stiffness: 120 });
        const handles = [m.cue({ patch: s, stagger: (p) => p.id * 4 })];
        return {
          handles,
          at: (t) => {
            if (t === 240) s.to(parts[3] as Part, -20);
            if (t === 400)
              handles.push(
                m.cue({ patch: glide<Part, Pose>('dark', { from: 0, velocity: 2, ms: 300 }) }),
              );
          },
        };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a crowd of tweens and fn voices, one per subject, beside a keys voice', () => {
    agree(
      (m, parts) => {
        const handles = [m.cue({ patch: pulse() })];
        for (const p of parts)
          handles.push(
            p.id % 2 === 0
              ? m.cue({
                  patch: tween<Part, Pose, number[]>('position', {
                    from: [0, 0, 0],
                    to: [p.id, -p.id, 1],
                    ms: 300 + p.id * 20,
                    ease: 'ease-out',
                  }),
                  subjects: [p],
                })
              : m.cue({ patch: wave(), subjects: [p] }),
          );
        return { handles };
      },
      { times: frames, parts: 40, probe },
    );
  });

  it('for a blend weighted by a signal', () => {
    agree(
      (m) => ({
        handles: m.blend(
          [pulse(), wave()],
          (p: Part, s: Setting) => 0.5 + 0.5 * Math.sin(s.elapsed / 90 + p.id),
          {
            fade: { in: 60 },
          },
        ),
      }),
      { times: frames, parts: 40, probe },
    );
  });
});

describe('a crowd of single-subject motion voices gives the pose the general path gives', () => {
  const ramp = [0, 16, 50, 120, 333, 500, 520, 700, 999, 1000, 1300, 1500, 1516, 1700, 2600];

  const each = (m: Mix<Part, Pose>, parts: Part[], start = 0) =>
    parts.map((p, i) =>
      i % 2 === 0
        ? m.cue({
            patch: tween<Part, Pose, number[]>('position', {
              from: [0, 0, 0],
              to: [p.id, -p.id, 1],
              ms: 200 + p.id * 30,
              ease: 'ease-out',
            }),
            subjects: [p],
            start,
          })
        : m.cue({
            patch: spring<Part, Pose, number[]>('position', {
              to: [p.id, 2, -1],
              stiffness: 150,
              damping: 12,
            }),
            subjects: [p],
            start,
          }),
    );

  it('for a tween or a spring per subject', () => {
    agree((m, parts) => ({ handles: each(m, parts) }), { times: ramp });
  });

  it('folded in voice order with shared voices on the same channel, before and after them', () => {
    agree(
      (m, parts) => {
        const a = m.cue({ patch: pulse() });
        const crowd = each(m, parts);
        const b = m.cue({ patch: wave(), weight: 0.4 });
        return { handles: [a, ...crowd, b] };
      },
      { times: ramp },
    );
  });

  it('with fades, weights, rates, ramps, seeks, retargets and subject fades between frames', () => {
    const play: Play = (m, parts) => {
      const tweens = parts.map((p) =>
        tween<Part, Pose, number[]>('position', { from: [0, 0, 0], to: [p.id, 1, 2], ms: 400 }),
      );
      const hs = parts.map((p, i) =>
        m.cue({
          patch: tweens[i] as ReturnType<typeof tween<Part, Pose, number[]>>,
          subjects: [p],
          fade: i % 3 === 0 ? { in: 150, out: 200 } : undefined,
          weight: i % 4 === 1 ? 0.5 : 1,
        }),
      );
      return {
        handles: hs,
        at: (t) => {
          if (t === 333) {
            (hs[1] as Handle<Part>).rate = 2;
            (hs[2] as Handle<Part>).weight = 0.25;
            (hs[3] as Handle<Part>).ramp(0.5, 300);
            (hs[4] as Handle<Part>).seek(50);
          }
          if (t === 500) {
            (hs[0] as Handle<Part>).fade({ over: 300 });
            (hs[5] as Handle<Part>).fade({ subject: parts[5] as Part, over: 200 });
            tweens[2]?.to(parts[2] as Part, [9, 9, 9]);
          }
          if (t === 1000)
            (tweens[5] as ReturnType<typeof tween<Part, Pose, number[]>>).to(
              parts[5] as Part,
              [1, 1, 1],
            );
          if (t === 1300) (hs[1] as Handle<Part>).fade({ subject: parts[1] as Part, over: 0 });
        },
      };
    };
    agree(play, { times: ramp });
    agree(play, { times: ramp, parts: 90, probe: (t, p) => p.id % 9 === 0 || t > 1400 });
  });

  for (const change of ['to', 'past', 'weight', 'rate', 'seek', 'fade', 'cue', 'drop'])
    it(`reads a tween per subject again after a ${change} between two reads of one frame`, () => {
      script((m, parts, look) => {
        const tweens = parts.map((p) =>
          tween<Part, Pose, number[]>('position', {
            from: [0, 0, 0],
            to: [p.id, -1, 2],
            ms: 400,
            ease: 'ease-in-out',
          }),
        );
        const hs = parts.map((p, i) =>
          m.cue({ patch: tweens[i] as (typeof tweens)[0], subjects: [p] }),
        );
        const [a, b, c] = parts as [Part, Part, Part];
        // A row is sampled bare from its third fill: the first numbers it, the second copies it.
        for (const t of [0, 16, 33]) {
          m.sync(t);
          for (const p of parts) look(p, hs);
        }
        m.sync(100);
        look(a, hs);
        look(b, hs);
        if (change === 'to') (tweens[0] as (typeof tweens)[0]).to(a, [9, 9, 9]);
        if (change === 'past') (tweens[0] as (typeof tweens)[0]).to(a, [9, 9, 9], 50);
        if (change === 'weight') (hs[0] as Handle<Part>).weight = 0.5;
        if (change === 'rate') (hs[0] as Handle<Part>).rate = 3;
        if (change === 'seek') (hs[0] as Handle<Part>).seek(250);
        if (change === 'fade') (hs[0] as Handle<Part>).fade({ over: 0 });
        if (change === 'cue') m.cue({ patch: pulse() });
        if (change === 'drop') m.drop(c);
        look(a, hs);
        look(b, hs);
        look(c, hs);
        look(a, hs);
        m.sync(116);
        for (const p of parts) look(p, hs);
      });
    });

  it('with voices starting late, finishing, dropped subjects and loops of one pass', () => {
    agree(
      (m, parts) => {
        const early = each(m, parts.slice(0, 3));
        const late = each(m, parts.slice(3), 500);
        return {
          handles: [...early, ...late],
          at: (t) => {
            if (t === 999) m.drop(parts[0] as Part);
            if (t === 1500) (early[1] as Handle<Part>).fade({ over: 0 });
          },
        };
      },
      { times: ramp },
    );
  });
});

describe('lanes give a one-axis vector channel the shape the general path gives', () => {
  it('for a tween voice, a tween per subject and a keys voice writing it', () => {
    agree(
      (m, parts) => {
        const shared = m.cue({
          patch: tween<Part, Pose, number[]>('bend', {
            from: [0],
            to: (p) => [p.id],
            ms: 400,
            ease: 'linear',
          }),
        });
        const each = parts.map((p) =>
          m.cue({
            patch: tween<Part, Pose, number[]>('bend', { from: [1], to: [-p.id], ms: 300 }),
            subjects: [p],
          }),
        );
        const stops = m.cue({
          patch: keys<Part, Pose>(500, [
            { at: 0, delta: { bend: [0] } },
            { at: 1, delta: { bend: [2] } },
          ]),
          weight: 0.5,
        });
        return { handles: [shared, ...each, stops] };
      },
      { times },
    );
  });
});

describe('a crowd of single-subject keys and fn voices gives the pose the general path gives', () => {
  const ramp = [0, 16, 50, 120, 333, 500, 520, 700, 999, 1000, 1300, 1500, 1516, 1700, 2600, 3000];

  /** One voice per part on `position`: keys, a stateless fn and a tween in turn. */
  const each = (m: Mix<Part, Pose>, parts: Part[], start = 0) =>
    parts.map((p, i) =>
      i % 3 === 0
        ? m.cue({
            patch: keys<Part, Pose>(400 + p.id * 20, [
              { at: 0, delta: { position: [0, 0, 0] } },
              { at: 0.5, delta: { position: [p.id, -1, 2] }, ease: 'ease-in' },
              { at: 1, delta: { position: [-p.id, 3, 0] } },
            ]),
            subjects: [p],
            start,
          })
        : i % 3 === 1
          ? m.cue({
              patch: patch<Part, Pose>(
                300 + p.id * 10,
                (phase, part) => ({ position: [phase * part.id, -0, 0.5 - phase] }),
                { writes: ['position'] },
              ),
              subjects: [p],
              start,
            })
          : m.cue({
              patch: tween<Part, Pose, number[]>('position', {
                from: [0, 0, 0],
                to: [p.id, 1, -1],
                ms: 250,
              }),
              subjects: [p],
              start,
            }),
    );

  it('for a keys, a fn or a tween voice per subject, beside shared voices on the channel', () => {
    agree(
      (m, parts) => {
        const a = m.cue({ patch: pulse() });
        const crowd = each(m, parts);
        const b = m.cue({ patch: wave(), weight: 0.4 });
        return { handles: [a, ...crowd, b] };
      },
      { times: ramp },
    );
  });

  it('with holds, loops, staggers, fades, weights, rates, seeks and subject fades', () => {
    const play: Play = (m, parts) => {
      const hs = parts.map((p, i) =>
        m.cue({
          patch:
            i % 2 === 0
              ? keys<Part, Pose>(300, [
                  { at: 0, delta: { gain: 0.2 } },
                  { at: 1, delta: { gain: 0.2 + p.id / 10 } },
                ])
              : patch<Part, Pose>(250, (phase) => ({ gain: 1 - phase / 2 }), {
                  writes: ['gain'],
                }),
          subjects: [p],
          loop: i % 4 < 2 ? 2 : true,
          freeze: i % 3 === 0 ? 'both' : i % 3 === 1 ? 'after' : undefined,
          start: i % 5 === 0 ? 300 : 0,
          fade: i % 3 === 2 ? { in: 150, out: 200 } : undefined,
          weight: i % 4 === 1 ? 0.5 : 1,
        }),
      );
      return {
        handles: hs,
        at: (t) => {
          if (t === 333) {
            (hs[1] as Handle<Part>).rate = 2;
            (hs[2] as Handle<Part>).weight = 0.25;
            (hs[3] as Handle<Part>).ramp(0.5, 300);
            (hs[4] as Handle<Part>).seek(50);
          }
          if (t === 500) {
            (hs[0] as Handle<Part>).fade({ over: 300 });
            (hs[5] as Handle<Part>).fade({ subject: parts[5] as Part, over: 200 });
          }
          if (t === 1300) (hs[1] as Handle<Part>).fade({ subject: parts[1] as Part, over: 0 });
        },
      };
    };
    agree(play, { times: ramp });
    agree(play, { times: ramp, parts: 90, probe: (t, p) => p.id % 9 === 0 || t > 1400 });
  });

  it('with voices starting late, finishing and dropped subjects', () => {
    agree(
      (m, parts) => {
        const early = each(m, parts.slice(0, 3));
        const late = each(m, parts.slice(3), 500);
        return {
          handles: [...early, ...late],
          at: (t) => {
            if (t === 999) m.drop(parts[0] as Part);
            if (t === 1500) (early[1] as Handle<Part>).fade({ over: 0 });
          },
        };
      },
      { times: ramp },
    );
  });

  it('for a fn per subject that starts keeping state partway through', () => {
    agree(
      (m, parts) => ({
        handles: parts.map((p) =>
          m.cue({
            patch: patch<Part, Pose>(
              0,
              (_ph, part, setting) => {
                if (setting.elapsed < 400) return { crawl: part.id };
                const n = setting.keep(part, () => ({ n: 0 }));
                n.n++;
                return { crawl: n.n };
              },
              { writes: ['crawl'] },
            ),
            subjects: [p],
          }),
        ),
      }),
      { times: ramp },
    );
  });

  it('for keys with a delay, short and typed stops and easeBy', () => {
    agree(
      (m, parts) => ({
        handles: parts.map((p, i) =>
          m.cue({
            patch: keys<Part, Pose>(
              600,
              [
                { at: 0, delta: { position: [1, 2] as number[] } },
                { at: 0.3, delta: { position: Float64Array.of(p.id, 0, -0) as never } },
                { at: 0.3, delta: { position: [5, 5, 5] }, ease: 'ease-out' },
                { at: 1, delta: { position: [-1, -0, p.id] } },
              ],
              {
                delayBy: () => (i % 2 === 0 ? 120 : 0),
                easeBy: () => (i % 3 === 0 ? { steps: 3 } : undefined),
              },
            ),
            subjects: [p],
            weight: i % 2 === 0 ? 0.7 : 1,
          }),
        ),
      }),
      { times: ramp },
    );
  });

  it('calls a fn voice per subject from the fill, once per frame each', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const seen: number[] = [];
    const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
    for (const p of parts)
      m.cue({
        patch: patch<Part, Pose>(
          0,
          (_ph, part) => {
            seen.push(part.id);
            return { crawl: part.id };
          },
          { writes: ['crawl'] },
        ),
        subjects: [p],
      });
    m.sync(0);
    for (const part of parts) m.probe(part);
    seen.length = 0;
    m.sync(16);
    m.probe(parts[3] as Part);
    m.probe(parts[1] as Part);
    // The general path would have called the patch for subjects 3 and 1 alone.
    expect(seen.sort()).toEqual([0, 1, 2, 3]);
  });

  it('for voices writing several channels, crowds sharing one folding in voice order', () => {
    // 1e16 + 1 rounds the 1 away, so the crawl folds to 0 in voice order and to 1 out of it.
    const both = (crawl: number) =>
      patch<Part, Pose>(0, (_ph, part) => ({ crawl, dark: part.id / 10 }), {
        writes: ['crawl', 'dark'],
      });
    agree(
      (m, parts) => ({
        handles: parts.flatMap((p) => [
          m.cue({ patch: both(1e16), subjects: [p] }),
          m.cue({
            patch: keys<Part, Pose>(400, [
              { at: 0, delta: { crawl: 1 } },
              { at: 1, delta: { crawl: 1 } },
            ]),
            subjects: [p],
          }),
          m.cue({ patch: both(-1e16), subjects: [p] }),
        ]),
      }),
      { times: ramp },
    );
    const m = mix<Part, Pose>(K, { lanes: true });
    const p = { id: 3 };
    m.cue({ patch: both(1e16), subjects: [p] });
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] }),
      subjects: [p],
    });
    m.cue({ patch: both(-1e16), subjects: [p] });
    for (const t of [0, 16, 32]) {
      m.sync(t);
      expect(m.probe(p).crawl).toBe(0);
    }
  });
});

describe('crowds take voices on and off as they come and go', () => {
  const frames = Array.from({ length: 100 }, (_, f) => f * 16);

  it('with voices replaced every frame, drops, pending starts and a shared voice coming and going', () => {
    const play: Play = (m, parts) => {
      const n = parts.length;
      const kinds = (p: Part, i: number) =>
        i % 3 === 0
          ? tween<Part, Pose, number[]>('position', { from: [0, 0, 0], to: [p.id, i, 1], ms: 300 })
          : i % 3 === 1
            ? keys<Part, Pose>(250, [
                { at: 0, delta: { position: [i, 0, 0] } },
                { at: 1, delta: { position: [0, p.id, -1] } },
              ])
            : patch<Part, Pose>(200, (ph) => ({ position: [ph * i, 1, p.id] }), {
                writes: ['position'],
              });
      const hs = parts.map((p, i) => m.cue({ patch: kinds(p, i), subjects: [p] }));
      let shared: Handle<Part> | null = null;
      let turn = 0;
      return {
        handles: hs,
        at: (t) => {
          const f = t / 16;
          for (let j = 0; j < 3; j++) {
            const k = turn++ % n;
            const p = parts[k] as Part;
            (hs[k] as Handle<Part>).fade({ over: f % 4 === 0 ? 40 : 0 });
            if (f % 5 === 0) m.drop(p);
            hs[k] = m.cue({
              patch: kinds(p, turn),
              subjects: [p],
              start: f % 7 === 0 ? t + 50 : undefined,
            });
          }
          // Late, so rows left empty pile up past where the crowds are rebuilt first.
          if (f === 60) shared = m.cue({ patch: pulse(), weight: 0.3 });
          if (f === 85) shared?.fade({ over: 0 });
        },
      };
    };
    agree(play, { times: frames, parts: 70 });
    agree(play, { times: frames, parts: 70, probe: (t, p) => p.id % 4 === 0 || t % 64 === 0 });
  }, 30_000);

  it('with a crowd voice starting in the frame a voice over every subject leaves', () => {
    const flick = (k: number) =>
      patch<Part, Pose>(
        180,
        (ph, p) => ({ gain: 0.5 + 0.4 * Math.sin(ph * 6 + p.id + k), dark: ph }),
        { writes: ['gain', 'dark'] },
      );
    const push = (v: number) => patch<Part, Pose>(180, () => ({ crawl: v }), { writes: ['crawl'] });
    agree(
      (m, parts) => {
        const a = m.cue({ patch: push(5) });
        const b = m.cue({ patch: push(3) });
        for (const p of parts) m.cue({ patch: flick(p.id), subjects: [p], weight: 0.7 });
        m.cue({ patch: flick(7), subjects: [parts[0] as Part], start: 50 });
        return {
          handles: [a, b],
          at: (t) => {
            if (t === 16) a.fade({ at: 'rest' });
            if (t === 50) b.fade({ at: 'rest' });
          },
        };
      },
      { times: [0, 16, 33, 50, 66, 83], parts: 4 },
    );
  });

  it('with a crowd voice starting in the frame a locus voice off the lanes starts', () => {
    agree(
      (m, parts) => {
        m.cue({
          patch: glide<Part, Pose, number>('crawl', { from: 1, velocity: 4, ms: 300 }),
          locus: 'b',
          start: 50,
        });
        const h = m.cue({
          patch: patch<Part, Pose>(0, () => ({ gain: 0.5 }), { writes: ['gain'] }),
          subjects: [parts[1] as Part],
          start: 50,
        });
        return { handles: [h] };
      },
      { times: [16, 170], parts: 2 },
    );
  });
});

describe('lanes weigh a subject fading out of its voice as the general path does', () => {
  const ramp = [0, 16, 33, 50, 66, 83, 100, 133, 166, 200, 233, 266, 300, 400];
  for (const weight of [0.37, 1, 1.6])
    it(`at weight ${weight}, for a fn, a keys and a tween voice over every subject`, () => {
      agree(
        (m, parts) => {
          const handles = [
            m.cue({ patch: pulse(), weight, fade: { in: 100 } }),
            m.cue({
              patch: keys<Part, Pose>(500, [
                { at: 0, delta: { crawl: 1 } },
                { at: 1, delta: { crawl: 4 } },
              ]),
              weight,
            }),
            m.cue({
              patch: tween<Part, Pose, number[]>('position', {
                from: [0, 0, 0],
                to: (p) => [p.id, 1, 2],
                ms: 300,
              }),
              weight,
              fade: { in: 50 },
            }),
          ];
          const at = (t: number) => {
            if (t !== 50) return;
            for (const p of parts.filter((p) => p.id % 2 === 0))
              for (const h of handles) h.fade({ subject: p, over: 200 });
          };
          return { handles, at };
        },
        { times: ramp, parts: 70 },
      );
    });
});

describe('a voice weighted by a signal runs on lanes while the signal keeps no state', () => {
  const ramp = [0, 16, 33, 50, 100, 150, 200, 333, 500, 700];
  const varying = (p: Part, s: Setting) => 0.5 + 0.5 * Math.sin(s.elapsed / 120 + p.id);

  /** How many subjects a fn voice's patch is called for on a frame probing two of six. */
  const calls = (weight: (p: Part, s: Setting) => number) => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const parts = Array.from({ length: 6 }, (_, id) => ({ id }));
    const seen = new Set<number>();
    m.cue({
      patch: patch<Part, Pose>(
        0,
        (_ph, p) => {
          seen.add(p.id);
          return { crawl: p.id };
        },
        { writes: ['crawl'] },
      ),
      weight,
    });
    m.sync(0);
    for (const p of parts) m.probe(p);
    seen.clear();
    m.sync(16);
    m.probe(parts[1] as Part);
    m.probe(parts[4] as Part);
    return seen.size;
  };

  it('fills every subject from the lane for a signal that keeps none', () => {
    expect(calls(varying)).toBe(6);
  });

  it('takes the general path for a signal that keeps state, from its first call', () => {
    expect(calls(slew(varying, { riseMs: 100 }))).toBe(2);
  });

  it('stops calling a motion voice’s signal for subjects nobody probed once it keeps state', () => {
    // From t=300 the signal counts frames per subject in kept state and reads by the count.
    // Subjects 90-99 go unread until 600; the first subject a fill meets may still get one call,
    // as `Setting.keep` says, so the unread ones are the last.
    const owner = {};
    const counting = (p: Part, s: Setting) => {
      if (s.timestamp < 300) return 0.5 + p.id / 200;
      const n = s.keep(owner, () => ({ n: 0, seen: Number.NaN }));
      if (n.seen !== s.timestamp) {
        n.n++;
        n.seen = s.timestamp;
      }
      return 1 / (1 + n.n);
    };
    agree(
      (m) => ({
        handles: [
          m.cue({
            patch: tween<Part, Pose, number>('crawl', {
              from: 0,
              to: (p) => p.id,
              ms: 2000,
            }),
            weight: counting,
          }),
        ],
      }),
      {
        times: [0, 100, 200, 300, 400, 500, 600],
        parts: 100,
        probe: (t, p) => t === 0 || t === 600 || p.id < 90,
      },
    );
  });

  it('gives the pose the general path gives, with a fade, a subject fade and pull', () => {
    for (const weight of [varying, slew(varying, { riseMs: 90, fallMs: 40 })])
      agree(
        (m, parts) => {
          const handles = [
            m.cue({ patch: pulse(), weight, fade: { in: 80 } }),
            m.cue({
              patch: tween<Part, Pose, number[]>('position', {
                from: [0, 0, 0],
                to: (p) => [p.id, 2, 0],
                ms: 400,
              }),
              weight,
            }),
            ...parts.map((p) =>
              m.cue({
                patch: keys<Part, Pose>(300, [
                  { at: 0, delta: { gain: 1 } },
                  { at: 1, delta: { gain: 0.4 } },
                ]),
                subjects: [p],
                weight,
              }),
            ),
          ];
          const at = (t: number) => {
            if (t === 150) handles[0]?.fade({ subject: parts[2] as Part, over: 100 });
          };
          return { handles, at };
        },
        { times: ramp, parts: 70 },
      );
  });

  it('asks the signal again at each sync while the mix is paused, as the general path does', () => {
    agree(
      (m) => {
        const knob = level<Part>(0.3);
        const handles = [
          m.cue({
            patch: spring<Part, Pose, number>('crawl', { from: 0, to: (p) => p.id + 1 }),
            weight: knob,
          }),
          m.cue({ patch: pulse(), weight: knob }),
        ];
        return {
          handles,
          at: (t) => {
            if (t === 50) m.rate = 0;
            if (t === 100) knob.set(0.9);
            if (t === 133) m.ramp(1, 40);
            if (t === 150) m.ramp(0, 40);
            if (t === 300) knob.set(0.6);
          },
        };
      },
      { times: [0, 16, 33, 50, 66, 100, 116, 133, 150, 166, 200, 300, 316] },
    );
  });
});

describe('a locus of keys and fn voices runs on lanes and folds as the general path folds it', () => {
  const ramp = [0, 16, 33, 50, 100, 150, 200, 250, 333, 500, 700, 900];
  const flicker = (k: number) =>
    patch<Part, Pose>(
      400,
      (ph, p) => ({ gain: 0.6 + 0.3 * Math.sin(ph * 5 + p.id + k), crawl: ph * k - p.id / 9 }),
      { writes: ['gain', 'crawl'] },
    );
  const sweep = keys<Part, Pose>(300, [
    { at: 0, delta: { crawl: 2, position: [1, 0, 0] } },
    { at: 1, delta: { crawl: -1, position: [0, 3, 1] } },
  ]);
  const by = (p: Part, s: Setting) => 0.5 + 0.5 * Math.sin(s.elapsed / 90 + p.id);

  it('for a blend, members reaching different subjects, weights over 1, fades and a voice between', () => {
    agree(
      (m, parts) => {
        const blend = m.blend([flicker(1), flicker(2), sweep], by, { fade: { in: 60 } });
        const between = m.cue({ patch: pulse(), weight: 0.7 });
        const handles = [
          ...blend,
          between,
          m.cue({ patch: flicker(3), locus: 'pair', weight: 1.4, target: (p) => p.id % 3 === 0 }),
          m.cue({ patch: sweep, locus: 'pair', weight: 0.6, fade: { in: 120, out: 80 } }),
          m.cue({ patch: flicker(4), locus: 'pair', subjects: parts.slice(5, 20) }),
        ];
        const at = (t: number) => {
          if (t === 150) handles[5]?.fade({ subject: parts[4] as Part, over: 100 });
          if (t === 333) handles[6]?.fade();
        };
        return { handles, at };
      },
      { times: ramp, parts: 70 },
    );
  });

  it('hands the whole locus to the general path when a member cannot run on a lane', () => {
    agree(
      (m, parts) => {
        const handles = [
          m.cue({ patch: flicker(1), locus: 'a' }),
          m.cue({ patch: sweep, locus: 'a', weight: 0.5 }),
        ];
        const at = (t: number) => {
          // A spring member writing a channel no other member writes still counts in the sum.
          if (t === 100)
            handles.push(
              m.cue({
                patch: spring<Part, Pose, number[]>('position', {
                  from: [0, 0, 0],
                  to: (p) => [p.id, 0, 0],
                }),
                locus: 'a',
                subjects: [parts[7] as Part],
              }),
            );
          if (t === 500) handles[2]?.fade({ over: 0 });
        };
        return { handles, at };
      },
      { times: ramp, parts: 70 },
    );
  });

  it('fills a blend from the lanes', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const parts = Array.from({ length: 6 }, (_, id) => ({ id }));
    const seen = new Set<number>();
    const counted = (k: number) =>
      patch<Part, Pose>(
        0,
        (_ph, p) => {
          seen.add(p.id);
          return { crawl: p.id * k };
        },
        { writes: ['crawl'] },
      );
    m.blend([counted(1), counted(2)], by);
    m.sync(0);
    for (const p of parts) m.probe(p);
    seen.clear();
    m.sync(16);
    m.probe(parts[2] as Part);
    expect(seen.size).toBe(6);
  });
});

describe('a voice a probe meets late, after every laned voice, folds onto the lanes’ values', () => {
  const flick = (k: number) =>
    patch<Part, Pose>(
      180,
      (ph, s) => ({ gain: 0.5 + 0.4 * Math.sin(ph * 6 + s.id + k), dark: ph }),
      {
        writes: ['gain', 'dark'],
      },
    );
  const glideTo = (s: Part) =>
    tween<Part, Pose, number[]>('position', { from: [0, 0, 0], to: [s.id, 1, 0], ms: 400 });

  /** A voice per part, and a voice over every part replaced at each time, with fades. */
  const swap =
    (late: boolean): Play =>
    (m, parts) => {
      for (const p of parts) m.cue({ patch: glideTo(p), subjects: [p] });
      for (const p of parts) m.cue({ patch: flick(p.id), subjects: [p], weight: 0.7 });
      let shared = m.cue({ patch: flick(9), fade: { in: 40 }, weight: 1.3 });
      const handles = [shared];
      let k = 0;
      return {
        handles,
        at: (t) => {
          if (t === 0) return;
          shared.fade({ over: k % 2 === 0 ? 0 : 30 });
          shared = m.cue({ patch: flick(k++), fade: { in: 40 }, weight: 0.4 + (k % 3) * 0.5 });
          handles.push(shared);
          // A voice naming one part, cued after the shared one, so it no longer folds last.
          if (late) m.cue({ patch: flick(k + 5), subjects: [parts[k % parts.length] as Part] });
        },
      };
    };
  const times = [0, 16, 33, 50, 66, 83, 100, 133, 166, 200, 250, 300, 450];

  it('reads what the general path reads, probed every frame', () => {
    agree(swap(false), { times });
  });

  it('reads what the general path reads, probed sparsely', () => {
    agree(swap(false), { times, probe: (t, part) => (part.id + Math.round(t)) % 3 !== 0 });
  });

  it('reads what the general path reads when a later voice takes the fold order', () => {
    agree(swap(true), { times });
  });

  it('reads an owed voice in a second pull of the same frame', () => {
    const run = (lanes: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
      const played = swap(false)(m, parts);
      const reads: Pose[][] = [];
      for (const t of [0, 16, 33]) {
        played?.at?.(t);
        m.sync(t);
        reads.push(pulled(m, parts), pulled(m, parts));
      }
      return reads.flat();
    };
    const off = run(false);
    for (const [i, pose] of run(true).entries()) expectSame(pose, off[i] as Pose, `read ${i}`);
  });

  it('reports the weight an owed voice has after atRest is the first to meet it', () => {
    const run = (lanes: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
      for (const p of parts) m.cue({ patch: glideTo(p), subjects: [p] });
      m.sync(0);
      for (const p of parts) m.probe(p);
      const h = m.cue({ patch: flick(1), fade: { in: 200 }, weight: 0.8 });
      m.sync(16);
      const rest = parts.map((p) => m.atRest(p));
      return [...rest, ...parts.map((p) => h.weightOf(p))];
    };
    expect(run(true)).toEqual(run(false));
  });

  it('owes the voice rather than sending the subject to the general path', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    const parts = Array.from({ length: 4 }, (_, id) => ({ id }));
    const played = swap(false)(m, parts);
    m.sync(0);
    for (const p of parts) m.probe(p);
    played?.at?.(16);
    m.sync(16);
    for (const p of parts) m.probe(p);
    // Subjects are numbered 0 up in the order they were first probed.
    const lanes = (m as unknown as { lanes: { owes(slot: number): boolean } }).lanes;
    expect(parts.filter((_, slot) => lanes.owes(slot))).toHaveLength(parts.length);
  });
});

describe('a color(last()) channel runs on lanes, the last voice past the band winning', () => {
  const RED = oklab(0xff0000);
  const BLUE = oklab(0x0000ff);
  const swing = (p: Part, s: Setting) => 0.5 + 0.5 * Math.sin(s.elapsed / 90 + p.id);
  const paint = (c: number[]) => patch<Part, Pose>(0, () => ({ tint: c }), { writes: ['tint'] });

  it('puts the channel on lanes', () => {
    const m = mix<Part, Pose>(K, { lanes: true });
    m.cue({ patch: paint(RED) });
    m.sync(0);
    m.probe({ id: 0 });
    m.sync(16);
    m.probe({ id: 0 });
    const lanes = (m as unknown as { lanes: { laned: { name: string }[] } }).lanes;
    expect(lanes.laned.map((c) => c.name)).toContain('tint');
  });

  it('with a later voice fading in and out across the band over an earlier one', () => {
    agree(
      (m) => {
        m.cue({ patch: paint(RED) });
        const h = m.cue({ patch: paint(BLUE), fade: { in: 400 } });
        return {
          handles: [h],
          at: (t) => {
            if (t === 1000) h.fade({ over: 700 });
          },
        };
      },
      { times: [0, 16, 100, 150, 200, 250, 300, 400, 1000, 1100, 1300, 1450, 1500, 1700, 1800] },
    );
  });

  it('with a signal weight swinging through the band, so the band holds between frames', () => {
    agree(
      (m) => {
        const h = m.cue({ patch: paint(BLUE), weight: swing });
        return { handles: [h] };
      },
      { times: Array.from({ length: 40 }, (_, i) => i * 23) },
    );
  });

  it('alongside other channels, from keys and fn voices, read sparsely', () => {
    agree(
      (m) => {
        const k = m.cue({
          patch: keys<Part, Pose>(600, [
            { at: 0, delta: { tint: RED, gain: 0.5 } },
            { at: 1, delta: { tint: BLUE, gain: 1.5 } },
          ]),
          fade: { in: 200 },
        });
        const f = m.cue({
          patch: patch<Part, Pose>(
            500,
            (phase, p) => (phase < 0.5 ? { tint: RED, crawl: p.id } : { crawl: -p.id }),
            { writes: ['tint', 'crawl'] },
          ),
          weight: swing,
        });
        return { handles: [k, f] };
      },
      {
        times: Array.from({ length: 30 }, (_, i) => i * 37),
        probe: (t, p) => (t / 37 + p.id) % 3 !== 0,
      },
    );
  });

  it('kept on the general path by a locus or a voice naming one subject, which fold it elsewhere', () => {
    agree(
      (m, parts) => {
        m.cue({ patch: paint(RED), locus: 'pair', weight: swing });
        m.cue({ patch: paint(BLUE), locus: 'pair' });
        const one = m.cue({
          patch: paint(oklab(0x00ff00)),
          subjects: [parts[2] as Part],
          fade: { in: 300 },
        });
        return { handles: [one] };
      },
      { times: Array.from({ length: 20 }, (_, i) => i * 41) },
    );
  });
});
