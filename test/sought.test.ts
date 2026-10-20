import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { slew } from '../src/signals.js';
import type { Handle, Mix, MixOptions } from '../src/types.js';
import { memoryStore } from './store.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
const subjects = ['a', 'b'];
const FRAME = 16.7;
const STEP = 5;
const BACK = 300;

/**
 * Integrates toward 50 by explicit Euler, with a term of each step's own time, so its value depends
 * on how it is stepped and on where its steps fall; counts its steps and the copies of its state.
 * With `elapsed`, a term of the voice's clock at the probe that stepped it too.
 */
function drift(duration = 0, elapsed = false) {
  const count = { steps: 0, copies: 0 };
  const made = patch<string, Pose, { x: number }>(duration, (_p, _s, st) => ({ x: st.state.x }), {
    writes: ['x'],
    state: (s) => ({ x: s === 'a' ? 0 : 10 }),
    step: (s, dt, _subject, setting) => {
      count.steps++;
      s.x += (50 - s.x) * Math.min(1, dt / 2000) + (setting.timestamp % 7) * 1e-4;
      if (elapsed) s.x += setting.elapsed * 1e-6;
    },
    pack: (s) => ({ ...s }),
    unpack: (d) => ({ ...(d as { x: number }) }),
  });
  const clone = (s: { x: number }) => {
    count.copies++;
    return { ...s };
  };
  return { p: { ...made, clone }, count };
}

/** Adds the host's `pull` each step, so its value depends on what the host read when it stepped. */
function pulled() {
  const count = { steps: 0, copies: 0 };
  const p = patch<string, Pose, { x: number }, { pull: number }>(
    0,
    (_p, _s, st) => ({ x: st.state.x }),
    {
      writes: ['x'],
      reads: ['pull'],
      state: () => ({ x: 0 }),
      step: (s, _dt, _subject, setting) => {
        count.steps++;
        s.x += setting.host.pull;
      },
    },
  );
  return { p, count };
}

const opts = (every?: number, extra: Partial<MixOptions> = {}): MixOptions => ({
  history: { ms: 5000, every, tape },
  stepMs: STEP,
  ...extra,
});

interface Loop {
  /** The voice's spec but for its patch; a function makes it on each mix. */
  cue?: object | ((m: Mix<string, Pose>) => object);
  /** Made on both mixes after each sync. */
  calls?: (m: Mix<string, Pose>, f: number, h: Handle<string>) => void;
  /** False where the two mixes are not held to show the same. */
  same?: boolean;
  make?: () => ReturnType<typeof drift>;
}

/**
 * Two mixes given the same calls, one sought `BACK` ms back and to where it was before every sync.
 * Answers both, the steps a subject the sought one ran each frame, and what the other showed by
 * mix time.
 */
function looped(
  frames: number,
  o: MixOptions,
  { cue = {}, calls, same = true, make = drift }: Loop = {},
) {
  const made = [make(), make()];
  const [sought, plain] = made.map(({ p }) => {
    const m = mix<string, Pose>(K, o);
    return { m, h: m.cue({ patch: p, ...(typeof cue === 'function' ? cue(m) : cue) }) };
  }) as [{ m: Mix<string, Pose>; h: Handle<string> }, { m: Mix<string, Pose>; h: Handle<string> }];
  const count = (made[0] as ReturnType<typeof drift>).count;
  const steps: number[] = [];
  const shown = new Map<number, number[]>();
  let t = 0;
  for (let f = 0; f < frames; f++) {
    t += FRAME;
    if (f >= 30) {
      const now = sought.m.now;
      sought.m.seek(now - BACK);
      sought.m.seek(now);
    }
    count.steps = 0;
    for (const { m, h } of [sought, plain]) {
      m.sync(t);
      calls?.(m, f, h);
    }
    const poses = subjects.map((s) => plain.m.probe(s).x);
    const got = subjects.map((s) => sought.m.probe(s).x);
    if (same) expect(got).toEqual(poses);
    expect(sought.m.now).toBe(plain.m.now);
    shown.set(plain.m.now, poses);
    steps.push(count.steps / subjects.length);
  }
  return { sought: sought.m, plain: plain.m, steps, count, shown, t };
}

describe('a mix sought back and to where it was, every frame', () => {
  for (const every of [50, undefined])
    it(`steps a subject over no more than the frame, as a mix never sought does, every ${every ?? 'left out'}`, () => {
      const { steps } = looped(330, opts(every));
      expect(Math.max(...steps.slice(40))).toBeLessThanOrEqual(Math.ceil(FRAME / STEP));
    });

  it('shows what it showed for a step reading its clock, stepped then and not again', () => {
    looped(200, opts(50), { make: () => drift(0, true) });
  });

  it("copies a subject's state once a frame, for the copy the probe keeps", () => {
    const frames = 330;
    const { count } = looped(frames, opts(50));
    // The record put back shares its copy's state until it steps, and then takes up the state of
    // the one the seek replaced, which nothing else holds: neither is copied.
    const each = count.copies / subjects.length / (frames - 30);
    expect(each).toBeGreaterThan(1);
    expect(each).toBeLessThan(1 + (2 * FRAME) / 50);
  });

  it('comes back to each moment it sought, and those around it, as it showed them', () => {
    const { sought, shown, t } = looped(120, opts(50));
    const at = [...shown.keys()];
    let host = t;
    for (const f of [118, 117, 101, 100, 99, 80, 62, 61, 45, 31, 12]) {
      sought.seek(at[f] as number);
      expect(subjects.map((s) => sought.probe(s).x)).toEqual(shown.get(at[f] as number));
      host += FRAME;
      sought.sync(host);
      const next = at[f + 1] as number;
      expect(sought.now).toBeCloseTo(next, 6);
    }
    // And played on from one of them, it shows what it showed.
    sought.seek(at[50] as number);
    for (let f = 51; f < 70; f++) {
      sought.seek(at[f] as number);
      expect(subjects.map((s) => sought.probe(s).x)).toEqual(shown.get(at[f] as number));
    }
  });

  it('shows what it showed through a rate, a seek and a fade on the voice', () => {
    const { sought, shown } = looped(200, opts(50), {
      cue: { fade: { in: 100, out: 400 } },
      calls: (_m, f, h) => {
        if (f === 60) (h as { rate: number }).rate = 0.5;
        if (f === 90) h.seek(2000);
        if (f === 120) h.seek(40, { state: 'keep' });
        if (f === 150) h.seek(70);
        if (f === 180) h.fade();
      },
    });
    // Before the seek that made its state afresh, it has the state it kept, not one made afresh.
    const at = [...shown.keys()];
    for (const f of [149, 145, 140, 136]) {
      sought.seek(at[f] as number);
      expect(subjects.map((s) => sought.probe(s).x)).toEqual(shown.get(at[f] as number));
    }
  });

  it('shows what it showed under a signal that keeps state, and a stagger', () => {
    looped(120, opts(50), { cue: { weight: slew(() => 1, { riseMs: 4000 }) } });
    looped(120, opts(50), { cue: { stagger: (s: string) => (s === 'a' ? 0 : 430) } });
  });

  it('shows what it showed where a rate or a seek moves a start a stagger put ahead', () => {
    const scenes: [number, number, string, 'before' | undefined][] = [[1500, 90, 'keep', 'before']];
    for (const delay of [600, 900, 1500])
      for (const f of [20, 40, 60, 90])
        for (const what of ['fast', 'slow', 'keep', 'seek', 'start'])
          scenes.push([delay, f, what, undefined]);
    for (const [delay, frame, what, freeze] of scenes) {
      const { sought, shown } = looped(160, opts(50), {
        cue: { stagger: (s: string) => (s === 'a' ? 0 : delay), freeze },
        calls: (_m, f, h) => {
          if (f !== frame) return;
          if (what === 'fast') (h as { rate: number }).rate = 2;
          if (what === 'slow') (h as { rate: number }).rate = 0.5;
          if (what === 'keep') h.seek(delay - 200, { state: 'keep' });
          if (what === 'seek') h.seek(delay - 200);
          if (what === 'start') h.seek(0);
        },
      });
      const at = [...shown.keys()];
      for (let f = 150; f > 30; f -= 7) {
        sought.seek(at[f] as number);
        expect(subjects.map((s) => sought.probe(s).x)).toEqual(shown.get(at[f] as number));
      }
    }
  });

  // A copy kept while a start was ahead holds the start as it was then; a seek cuts the copies
  // after the moment it sought, so every later one puts the record back from that copy.
  describe('where a start is moved while a voice freezing before it waits', () => {
    const waits = (delay: number) => ({
      stagger: (s: string) => (s === 'a' ? 0 : delay),
      freeze: 'before' as const,
    });
    const moves: Record<string, (h: Handle<string>, delay: number) => void> = {
      'a faster rate': (h) => {
        (h as { rate: number }).rate = 2;
      },
      'a slower rate': (h) => {
        (h as { rate: number }).rate = 0.5;
      },
      'a ramp': (h) => h.ramp(0.25, 300),
      'a seek that keeps state': (h, delay) => void h.seek(delay - 200, { state: 'keep' }),
    };
    for (const [what, move] of Object.entries(moves))
      for (const delay of [600, 900])
        it(`shows what it showed after ${what}, ${delay} ms into a stagger`, () => {
          looped(120, opts(), {
            cue: waits(delay),
            calls: (_m, f, h) => {
              if (f === 27) move(h, delay);
            },
          });
        });

    for (const rate of [0.5, 2])
      it(`shows what it showed after its owner's rate goes to ${rate}`, () => {
        const owners = new Map<Mix<string, Pose>, Handle<string>>();
        looped(120, opts(), {
          cue: (m) => {
            const owner = m.owns({});
            owners.set(m, owner);
            return { owner, ...waits(600) };
          },
          calls: (m, f) => {
            if (f === 27) (owners.get(m) as { rate: number }).rate = rate;
          },
        });
      });

    it("shows what it showed after the mix's rate moves a start given in host time", () => {
      looped(120, opts(), {
        cue: { start: 500, ...waits(200) },
        calls: (m, f) => {
          if (f === 20) m.rate = 2;
        },
      });
    });

    it('steps a subject whose start moved again over no more than the way back', () => {
      const { steps } = looped(330, opts(50), {
        cue: waits(600),
        calls: (_m, f, h) => {
          if (f === 27) (h as { rate: number }).rate = 0.5;
        },
      });
      expect(Math.max(...steps.slice(40))).toBeLessThanOrEqual(
        Math.ceil((BACK + 50 + 2 * FRAME) / STEP),
      );
    });

    it('shows what it showed after an anchor places its start', () => {
      looped(120, opts(), {
        cue: { anchor: { start: { with: 'go' } }, ...waits(300) },
        calls: (m, f) => {
          if (f === 27) m.announce('go');
        },
      });
    });

    it('reads back the frames after the move as it showed them', () => {
      const { plain, shown } = looped(60, opts(), {
        cue: waits(600),
        calls: (_m, f, h) => {
          if (f === 27) (h as { rate: number }).rate = 2;
        },
      });
      for (const [at, poses] of shown)
        expect(subjects.map((s) => plain.project(at).probe(s).x)).toEqual(poses);
    });
  });

  it('steps a voice frozen after its last pass no further than its end', () => {
    looped(120, opts(50), { cue: { loop: 1, freeze: 'after' }, make: () => drift(800) });
  });

  // State stepped ahead at one probe would hold steps run on what the host read then.
  it('steps a patch that reads the host again on what the host reads now', () => {
    const host = { pull: 0 };
    const { sought, steps } = looped(60, opts(50, { host }), {
      make: pulled as unknown as () => ReturnType<typeof drift>,
      same: false,
      calls: (_m, f) => {
        host.pull = f < 30 ? 0 : f;
      },
    });
    expect(sought.probe('a').x).toBe((steps[59] as number) * 59);
  });

  // A record put back steps over more than `maxDt` in one probe, so it skips steps the mix ran.
  it('runs no more steps a probe than maxDt allows', () => {
    const { steps } = looped(120, opts(50, { maxDt: 100 }), { same: false });
    expect(Math.max(...steps.slice(31))).toBeLessThanOrEqual(100 / STEP);
  });

  it('reads back past memory what it showed, from a store', async () => {
    const store = memoryStore();
    const o: MixOptions = { history: { ms: 400, every: 50, tape, store }, stepMs: STEP };
    const { sought, shown } = looped(200, o);
    const at = [...shown.keys()];
    for (const f of [150, 100, 60]) {
      await sought.prepare(at[f] as number);
      sought.seek(at[f] as number);
      expect(subjects.map((s) => sought.probe(s).x)).toEqual(shown.get(at[f] as number));
    }
  });
});
