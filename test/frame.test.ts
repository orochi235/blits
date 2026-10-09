import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });

interface Part {
  id: string;
}

describe('one frame, one answer', () => {
  it('a stateful patch probed twelve times at one now steps once', () => {
    let steps = 0;
    const counting = patch<Part, Pose, { ticks: number }>(
      0,
      (_phase, _part, setting) => ({ crawl: setting.state.ticks }),
      {
        writes: ['crawl'],
        state: () => ({ ticks: 0 }),
        step: (state) => {
          state.ticks++;
          steps++;
        },
      },
    );
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: counting });
    const part = { id: 'a' };

    m.sync(0);
    for (let i = 0; i < 12; i++) m.probe(part);
    expect(steps).toBe(0);

    m.sync(16);
    for (let i = 0; i < 12; i++) m.probe(part);
    expect(steps).toBe(1);
  });

  it('a probe after a seek in the same frame reads where the seek put the voice, stepping once', () => {
    let steps = 0;
    const p = patch<Part, Pose, { n: number }>(
      1000,
      (phase, _part, setting) => ({ gain: 1 + phase, crawl: setting.state.n }),
      {
        writes: ['gain', 'crawl'],
        state: () => ({ n: 0 }),
        step: (state) => {
          state.n++;
          steps++;
        },
      },
    );
    const m = mix<Part, Pose>(PART, { lanes: false });
    const h = m.cue({ patch: p });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(100);
    expect(m.probe(part).gain).toBeCloseTo(1.1, 9);
    h.seek(600, { state: 'keep' });
    const after = m.probe(part);
    expect(after.gain).toBeCloseTo(1.6, 9);
    expect(after.crawl).toBe(1);
    expect(steps).toBe(1);
  });

  it('a probe after a rebuilding seek in the same frame reads state stepped to where it went', () => {
    const p = patch<Part, Pose, { n: number }>(1000, (_phase, _part, s) => ({ crawl: s.state.n }), {
      writes: ['crawl'],
      state: () => ({ n: 0 }),
      step: (state) => {
        state.n++;
      },
    });
    const m = mix<Part, Pose>(PART, { lanes: false, stepMs: 100 });
    const h = m.cue({ patch: p });
    const part = { id: 'a' };
    m.sync(0);
    m.sync(100);
    expect(m.probe(part).crawl).toBe(1);
    h.seek(600);
    expect(m.probe(part).crawl).toBe(6);
  });

  it('a voice faded before its start plays once its start arrives, with no other cue', () => {
    const m = mix<Part, Pose>(PART, { lanes: false });
    const part = { id: 'a' };
    m.cue({ patch: patch<Part, Pose>(0, () => ({ gain: 2 }), { writes: ['gain'] }) });
    const late = m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 5 }), { writes: ['crawl'] }),
      start: 300,
    });
    m.sync(100);
    expect(m.probe(part).crawl).toBe(0);
    late.fade({ over: 2000 });
    m.sync(400);
    expect(m.probe(part).crawl).toBeGreaterThan(0);
  });

  it('a second sync with the same now is a no-op', () => {
    const steps: number[] = [];
    const counting = patch<Part, Pose, { n: number }>(0, () => ({}), {
      writes: [],
      state: () => ({ n: 0 }),
      step: (_s, dt) => steps.push(dt),
    });
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: counting });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    expect(steps).toEqual([16]);
  });
});

describe('catch-up', () => {
  it('a subject unprobed for three frames steps by the whole gap on the fourth', () => {
    const gaps: number[] = [];
    const counting = patch<Part, Pose, { n: number }>(0, () => ({}), {
      writes: [],
      state: () => ({ n: 0 }),
      step: (_s, dt) => gaps.push(dt),
    });
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: counting });
    const watched = { id: 'watched' };
    const ignored = { id: 'ignored' };

    for (const now of [0, 16, 32, 48]) {
      m.sync(now);
      m.probe(watched);
    }
    m.probe(ignored);
    expect(gaps).toEqual([16, 16, 16]);

    m.sync(64);
    m.probe(ignored);
    expect(gaps.at(-1)).toBe(64 - 48);
  });

  it('the gap is never subdivided: one catch-up, not one per frame missed', () => {
    const gaps: number[] = [];
    const counting = patch<Part, Pose, { n: number }>(0, () => ({}), {
      writes: [],
      state: () => ({ n: 0 }),
      step: (_s, dt) => gaps.push(dt),
    });
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: counting });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.sync(32);
    m.sync(48);
    m.probe(part);
    expect(gaps).toEqual([48]);
  });
});

describe('the clock', () => {
  it('phase is 0..1 across the duration and wraps', () => {
    const seen: number[] = [];
    const p = patch<Part, Pose>(
      1000,
      (phase) => {
        seen.push(phase);
        return {};
      },
      { writes: [] },
    );
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: p });
    const part = { id: 'a' };
    for (const now of [0, 250, 500, 1000, 1250]) {
      m.sync(now);
      m.probe(part);
    }
    expect(seen).toEqual([0, 0.25, 0.5, 0, 0.25]);
  });

  it('a patch that sets only the deprecated period plays passes of that length', () => {
    const seen: number[] = [];
    const { duration: _, ...built } = patch<Part, Pose>(
      1000,
      (phase) => {
        seen.push(phase);
        return {};
      },
      { writes: [] },
    );
    expect(built.period).toBe(1000);
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: built as never });
    const part = { id: 'a' };
    for (const now of [0, 250, 1250]) {
      m.sync(now);
      m.probe(part);
    }
    expect(seen).toEqual([0, 0.25, 0.25]);
  });

  it('a duration of 0 holds phase and pass at 0 and hands over elapsed instead', () => {
    const seen: { phase: number; pass: number; elapsed: number }[] = [];
    const p = patch<Part, Pose>(
      0,
      (phase, _part, setting) => {
        seen.push({ phase, pass: setting.pass, elapsed: setting.elapsed });
        return {};
      },
      { writes: [] },
    );
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: p, loop: false });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(900);
    m.probe(part);
    expect(seen).toEqual([
      { phase: 0, pass: 0, elapsed: 0 },
      { phase: 0, pass: 0, elapsed: 900 },
    ]);
  });

  it("seek with state: 'keep' moves the clock and leaves state where it was", () => {
    let ticks = 0;
    const p = patch<Part, Pose, { n: number }>(
      1000,
      (phase, _part, setting) => ({ crawl: phase * 100 + setting.state.n }),
      {
        writes: ['crawl'],
        state: () => ({ n: 0 }),
        step: (state) => {
          state.n++;
          ticks++;
        },
      },
    );
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: p });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(100);
    m.probe(part);
    expect(ticks).toBe(1);

    expect(h.seek(4000, { state: 'keep' })).toBe('held');
    m.sync(200);
    const pose = m.probe(part);
    // Phase jumped to 4000 + 100 ms of playback; state advanced once for the frame, not to 4000.
    expect(pose.crawl).toBeCloseTo(0.1 * 100 + 2, 9);
    expect(ticks).toBe(2);
  });

  it('a rate change rebases so elapsed is continuous', () => {
    const seen: number[] = [];
    const p = patch<Part, Pose>(
      0,
      (_phase, _part, setting) => {
        seen.push(setting.elapsed);
        return {};
      },
      { writes: [] },
    );
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: p });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(100);
    m.probe(part);
    h.rate = 2;
    m.sync(200);
    m.probe(part);
    expect(seen).toEqual([0, 100, 300]);
  });
});

describe('reduced motion', () => {
  it('hands the patch an infinite dt so it snaps rather than integrates', () => {
    const gaps: number[] = [];
    const p = patch<Part, Pose, { n: number }>(0, () => ({}), {
      writes: [],
      state: () => ({ n: 0 }),
      step: (_s, dt) => gaps.push(dt),
    });
    const m = mix<Part, Pose>(PART, { reduce: true });
    m.cue({ patch: p });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    expect(gaps).toEqual([Number.POSITIVE_INFINITY]);
  });
});

describe('time away', () => {
  const still = () => patch<Part, Pose>(0, () => ({ crawl: 10 }), { writes: ['crawl'] });

  it('rebase makes the next sync continuous, so a fade picks up where it was left', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.cue({ patch: still(), start: 0, fade: { in: 200 } });
    m.sync(100);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
    m.rebase();
    m.sync(3_600_100);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
    m.sync(3_600_150);
    expect(m.probe(part).crawl).toBeCloseTo(7.5, 9);
  });

  it('a step after a rebase sees the frame gap, not the time away', () => {
    const gaps: number[] = [];
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: (_s, dt) => gaps.push(dt),
      }),
    });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    m.rebase();
    m.sync(60_000);
    m.probe(part);
    m.sync(60_016);
    m.probe(part);
    expect(gaps).toEqual([16, 16]);
  });

  it('a start given after a rebase is read on the host clock', () => {
    const m = mix<Part, Pose>(PART);
    const part = { id: 'a' };
    m.sync(0);
    m.rebase();
    m.sync(10_000);
    m.cue({ patch: still(), start: 10_100 });
    m.sync(10_050);
    expect(m.probe(part).crawl).toBe(0);
    m.sync(10_100);
    expect(m.probe(part).crawl).toBe(10);
  });

  it('maxDt caps the gap a step is handed', () => {
    const gaps: number[] = [];
    const m = mix<Part, Pose>(PART, { maxDt: 64 });
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: (_s, dt) => gaps.push(dt),
      }),
    });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    m.sync(10_016);
    m.probe(part);
    expect(gaps).toEqual([16, 64]);
  });
});

describe('stepMs', () => {
  interface Spring {
    x: number;
    v: number;
  }
  // Semi-implicit Euler toward 100: the integrator NOTES-ON-SCRUBBING.md measured drifting by frame rate.
  const spring = () =>
    patch<Part, Pose, Spring>(0, (_p, _s, setting) => ({ crawl: setting.state.x }), {
      writes: ['crawl'],
      state: () => ({ x: 0, v: 0 }),
      step: (s, dt) => {
        const t = dt / 1000;
        s.v += (180 * (100 - s.x) - 12 * s.v) * t;
        s.x += s.v * t;
      },
    });
  const at300 = (fps: number, stepMs?: number): number => {
    const m = mix<Part, Pose>(PART, { stepMs });
    m.cue({ patch: spring() });
    const part = { id: 'a' };
    const every = 1000 / fps;
    for (let n = 0; n * every < 300; n++) {
      m.sync(n * every);
      m.probe(part);
    }
    m.sync(300);
    return m.probe(part).crawl;
  };

  it('plays a stateful patch the same at any frame rate', () => {
    const exact = at300(200, 5);
    for (const fps of [144, 120, 60, 30, 24]) expect(at300(fps, 5)).toBe(exact);
    expect(at300(30)).not.toBeCloseTo(at300(144), 1);
  });

  it('hands step the interval and the time each interval ends, carrying the remainder', () => {
    const calls: [number, number][] = [];
    const m = mix<Part, Pose>(PART, { stepMs: 5 });
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: (_s, dt, _subject, setting) => calls.push([setting.timestamp, dt]),
      }),
    });
    const part = { id: 'a' };
    for (const now of [0, 7, 13, 16, 31]) {
      m.sync(now);
      m.probe(part);
    }
    expect(calls).toEqual([
      [5, 5],
      [10, 5],
      [15, 5],
      [20, 5],
      [25, 5],
      [30, 5],
    ]);
  });

  it('counts intervals from when a staggered subject starts', () => {
    const calls: number[] = [];
    const m = mix<Part, Pose>(PART, { stepMs: 10 });
    m.cue({
      stagger: () => 3,
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: (_s, _dt, _subject, setting) => calls.push(setting.timestamp),
      }),
    });
    const part = { id: 'a' };
    for (const now of [0, 16, 33]) {
      m.sync(now);
      m.probe(part);
    }
    expect(calls).toEqual([13, 23, 33]);
  });

  it('runs no more intervals in one sample than maxDt holds', () => {
    let count = 0;
    const m = mix<Part, Pose>(PART, { stepMs: 5, maxDt: 20 });
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: () => {
          count++;
        },
      }),
    });
    const part = { id: 'a' };
    m.sync(0);
    m.probe(part);
    m.sync(10_000);
    m.probe(part);
    expect(count).toBe(4);
  });
});

describe('stepMs at an interval that is not a whole number of ms', () => {
  it('runs one step per interval at 120 Hz sampled at 120 Hz', () => {
    let count = 0;
    const tick = 1000 / 120;
    const m = mix<Part, Pose>(PART, { stepMs: tick });
    m.cue({
      patch: patch<Part, Pose, null>(0, () => ({}), {
        writes: [],
        state: () => null,
        step: () => {
          count++;
        },
      }),
    });
    const part = { id: 'a' };
    for (let n = 0; n <= 120; n++) {
      m.sync(n * tick);
      m.probe(part);
    }
    expect(count).toBe(120);
  });
});

describe('voices targeted at one subject each', () => {
  const crawl = (v: number) => patch<Part, Pose>(0, () => ({ crawl: v }), { writes: ['crawl'] });

  it('fold only into the subject they target, and asks target once per subject', () => {
    const subjects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const asked: string[] = [];
    const m = mix<Part, Pose>(PART);
    subjects.forEach((mine, i) => {
      m.cue({
        patch: crawl(i + 1),
        target: (s) => {
          asked.push(`${i}:${s.id}`);
          return s === mine;
        },
      });
    });
    for (const now of [0, 16, 32]) {
      m.sync(now);
      expect(subjects.map((s) => m.probe(s).crawl)).toEqual([1, 2, 3]);
    }
    expect(asked).toHaveLength(9);
  });

  it('pick up a voice cued later, drop one that finished, and wait to ask a pending one', () => {
    const a = { id: 'a' };
    let asked = 0;
    const m = mix<Part, Pose>(PART);
    const first = m.cue({ patch: crawl(1), target: (s) => s === a });
    m.cue({
      patch: crawl(10),
      start: 100,
      target: (s) => {
        asked++;
        return s === a;
      },
    });
    m.sync(0);
    expect(m.probe(a).crawl).toBe(1);
    expect(asked).toBe(0);
    m.sync(100);
    expect(m.probe(a).crawl).toBe(11);
    expect(asked).toBe(1);
    first.fade();
    m.sync(116);
    expect(m.probe(a).crawl).toBe(10);
    m.cue({ patch: crawl(100) });
    m.sync(132);
    expect(m.probe(a).crawl).toBe(110);
  });
});

describe('voices naming their subjects', () => {
  const crawl = (v: number) => patch<Part, Pose>(0, () => ({ crawl: v }), { writes: ['crawl'] });
  const clock = () =>
    patch<Part, Pose>(0, (_p, _s, setting) => ({ crawl: setting.elapsed }), { writes: ['crawl'] });

  it('fold one voice per subject only into the subject each names', () => {
    const subjects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const m = mix<Part, Pose>(PART);
    const handles = subjects.map((mine, i) => m.cue({ patch: crawl(i + 1), subjects: [mine] }));
    const stranger = { id: 'stranger' };
    for (const now of [0, 16, 32]) {
      m.sync(now);
      expect(subjects.map((s) => m.probe(s).crawl)).toEqual([1, 2, 3]);
      expect(m.probe(stranger).crawl).toBe(0);
    }
    expect(handles.map((h) => h.weightOf(subjects[0] as Part))).toEqual([1, 0, 0]);
    expect((handles[0] as { weightOf(s: Part): number }).weightOf(stranger)).toBe(0);
  });

  it('fold several voices naming one subject, and one voice naming several, matched by identity', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: crawl(1), subjects: [a] });
    m.cue({ patch: crawl(10), subjects: [a, b, a] });
    m.cue({ patch: crawl(100), subjects: [b] });
    m.sync(0);
    expect(m.probe(a).crawl).toBe(11);
    expect(m.probe(b).crawl).toBe(110);
    expect(m.probe({ id: 'a' }).crawl).toBe(0);
  });

  it('play alongside targeted and untargeted voices, and never ask target of a named voice', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const asked: string[] = [];
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: crawl(1) });
    m.cue({ patch: crawl(10), subjects: [a] });
    m.cue({
      patch: crawl(100),
      target: (s) => {
        asked.push(s.id);
        return s === b;
      },
    });
    m.cue({ patch: crawl(1000), subjects: [b] });
    for (const now of [0, 16]) {
      m.sync(now);
      expect(m.probe(a).crawl).toBe(11);
      expect(m.probe(b).crawl).toBe(1101);
    }
    expect(asked).toEqual(['a', 'b']);
  });

  it('pick up a named voice once it goes live, and drop one that left', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(PART);
    const first = m.cue({ patch: crawl(1), subjects: [a] });
    m.cue({ patch: crawl(10), start: 100, subjects: [a] });
    m.sync(0);
    expect(m.probe(a).crawl).toBe(1);
    m.sync(100);
    expect(m.probe(a).crawl).toBe(11);
    first.fade();
    m.sync(116);
    expect(m.probe(a).crawl).toBe(10);
    m.cue({ patch: crawl(100), subjects: [a] });
    m.sync(132);
    expect(m.probe(a).crawl).toBe(110);
  });

  it('are refused at cue alongside a target', () => {
    const m = mix<Part, Pose>(PART);
    const a = { id: 'a' };
    expect(() => m.cue({ patch: crawl(1), subjects: [a], target: () => true })).toThrow(
      /target or subjects/,
    );
  });

  it('read back through a projection, including a voice that has since left', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(PART, { history: { ms: 1000 } });
    m.sync(0);
    const gone = m.cue({ patch: clock(), subjects: [a] });
    m.cue({ patch: crawl(1000), subjects: [b] });
    for (let t = 16; t <= 160; t += 16) {
      m.sync(t);
      m.probe(a);
      m.probe(b);
    }
    gone.fade();
    m.sync(176);
    expect(m.probe(a).crawl).toBe(0);
    const back = m.project(80);
    expect(back.probe(a).crawl).toBe(80);
    expect(back.probe(b).crawl).toBe(1000);
    const ahead = m.project(300);
    expect(ahead.probe(a).crawl).toBe(0);
    expect(ahead.probe(b).crawl).toBe(1000);
  });

  it('let a projection ahead drop a named voice that leaves within it', () => {
    const a = { id: 'a' };
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: crawl(1), subjects: [a], loop: false });
    m.cue({
      patch: patch<Part, Pose>(100, () => ({ crawl: 10 }), { writes: ['crawl'] }),
      subjects: [a],
      loop: false,
    });
    m.sync(0);
    expect(m.probe(a).crawl).toBe(11);
    expect(m.project(200).probe(a).crawl).toBe(1);
  });

  it('assess a voice waiting on an anchor as held only for the subjects it names', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const m = mix<Part, Pose>(PART);
    m.sync(0);
    m.cue({ patch: crawl(1), subjects: [a], anchor: { start: { after: 'reply' } } });
    m.probe(a);
    m.probe(b);
    expect(m.project(100).assess(a).crawl).toBe('held');
    expect(m.project(100).assess(b).crawl).toBe('exact');
  });
});

describe('a voice cued before the first sync', () => {
  it('is pending until its start, not live', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] }),
      start: 100,
    });
    expect(h.state).toBe('pending');
    m.sync(0);
    expect(h.state).toBe('pending');
    m.sync(100);
    expect(h.state).toBe('live');
  });
});

describe('handle.ramp', () => {
  const clock = () =>
    patch<Part, Pose>(0, (_p, _s, setting) => ({ crawl: setting.elapsed }), { writes: ['crawl'] });

  it('eases the rate in, so the voice clock integrates it and never jumps', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: clock() });
    const part = { id: 'a' };
    m.sync(0);
    m.sync(100);
    expect(m.probe(part).crawl).toBe(100);
    h.ramp(0, 200);
    m.sync(200);
    // Half way down a linear ramp from 1 to 0 over 200 ms: 100 · (1 + 0.5) / 2.
    expect(m.probe(part).crawl).toBeCloseTo(175, 9);
    expect(h.rate).toBeCloseTo(0.5, 9);
    m.sync(300);
    expect(m.probe(part).crawl).toBeCloseTo(200, 9);
    m.sync(1000);
    expect(m.probe(part).crawl).toBeCloseTo(200, 9);
    expect(h.rate).toBe(0);
  });

  it('keeps going through a seek, and a rate write replaces it', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: clock() });
    const part = { id: 'a' };
    m.sync(0);
    h.ramp(3, 100);
    m.sync(50);
    h.seek(0);
    m.sync(100);
    // From the seek at 50: rate 2 → 3 over the 50 ms left, 50 · 2.5.
    expect(m.probe(part).crawl).toBeCloseTo(125, 9);
    h.rate = 1;
    m.sync(150);
    expect(m.probe(part).crawl).toBeCloseTo(175, 9);
  });
});
