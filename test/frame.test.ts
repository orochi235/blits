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
  it('phase is 0..1 across the period and wraps', () => {
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

  it('a period of 0 holds phase and pass at 0 and hands over elapsed instead', () => {
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

  it('seek moves the clock and leaves state where it was', () => {
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

    h.seek(4000);
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
