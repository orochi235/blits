import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { curve } from '../src/easing.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { remapLength, sourceAt } from '../src/remap.js';
import type { Mix, MixOptions } from '../src/types.js';
import { a, clock, K, type Part, type Pose, x } from './owner-fixtures.js';

/** x runs from 0 to 1000 over a 1000 ms pass, so a pose shows the time its patch is read at. */
const line = keys<Part, Pose>(1000, [
  { at: 0, delta: { x: 0 } },
  { at: 1, delta: { x: 1000 } },
]);
/** The same as a function of its phase. */
const fnLine = patch<Part, Pose>(1000, (u) => ({ x: u * 1000 }), { writes: ['x'] });

const HISTORY: MixOptions = { history: { ms: 1e9, every: 50, tape } };

const made = (opts: MixOptions = {}): Mix<Part, Pose> => {
  const m = mix<Part, Pose>(K, opts);
  m.sync(0);
  return m;
};

describe('a voice remap', () => {
  for (const [name, p] of [
    ['keys', line],
    ['fn', fnLine],
  ] as const) {
    it(`plays a window of its ${name} patch, then leaves`, () => {
      const m = made();
      const h = m.cue({ patch: p, start: 0, remap: { window: [200, 600] } });
      expect(x(m, 0)).toBe(200);
      expect(x(m, 100)).toBe(300);
      expect(x(m, 399)).toBeCloseTo(599);
      x(m, 401);
      expect(h.state).toBe('done');
    });

    it(`plays a ${name} window backward, at its own length`, () => {
      const m = made();
      m.cue({ patch: p, start: 0, remap: { window: [800, 400], length: 200 } });
      expect(x(m, 0)).toBe(800);
      expect(x(m, 100)).toBe(600);
      expect(x(m, 150)).toBe(500);
    });

    it(`loops a ${name} window, freezing after on its end`, () => {
      const m = made();
      m.cue({ patch: p, start: 0, loop: 2, freeze: 'after', remap: { window: [100, 300] } });
      expect(x(m, 50)).toBe(150);
      expect(x(m, 250)).toBe(150);
      expect(x(m, 1000)).toBe(300);
    });
  }

  it('scrubs along a curve that turns back, and holds a window of one time', () => {
    const m = made();
    m.cue({ patch: line, start: 0, remap: { curve: { linear: [0, 1, 0] }, length: 400 } });
    expect(x(m, 100)).toBe(500);
    expect(x(m, 200)).toBe(1000);
    expect(x(m, 300)).toBe(500);
    const n = made();
    n.cue({ patch: line, start: 0, loop: true, remap: { window: [250, 250], length: 100 } });
    expect(x(n, 30)).toBe(250);
    expect(x(n, 5000)).toBe(250);
  });

  it('runs at its rate through the window, and its pass length sets its passes', () => {
    const m = made();
    const h = m.cue({ patch: line, start: 0, rate: 2, remap: { window: [0, 500] } });
    expect(x(m, 100)).toBe(200);
    x(m, 251);
    expect(h.state).toBe('done');
    expect(remapLength({ window: [0, 500] }, 1000)).toBe(500);
    expect(remapLength({ curve: 'ease-in' }, 1000)).toBe(1000);
  });

  it('hands a patch the source time as elapsed, and its own pass', () => {
    const seen: [number, number][] = [];
    const spy = patch<Part, Pose>(
      100,
      (_u, _s, setting) => {
        seen.push([setting.elapsed, setting.pass]);
        return { x: 0 };
      },
      { writes: ['x'] },
    );
    const m = made();
    m.cue({ patch: spy, start: 0, loop: true, remap: { window: [40, 60] } });
    x(m, 10);
    x(m, 30);
    expect(seen.at(-2)).toEqual([50, 0]);
    expect(seen.at(-1)).toEqual([50, 1]);
  });

  it('reads as sourceAt says, through every curve', () => {
    const remap = { window: [100, 900] as const, curve: 'ease-in-out' as const, length: 300 };
    const m = made();
    m.cue({ patch: line, start: 0, loop: true, remap });
    for (const t of [0, 40, 150, 299, 310, 777])
      expect(x(m, t)).toBeCloseTo(sourceAt(remap, t, 1000, true), 9);
    const ease = curve('ease-in-out');
    expect(sourceAt(remap, 150, 1000)).toBeCloseTo(100 + ease(0.5) * 800, 9);
  });

  it('agrees with play on a seek back and a read ahead', () => {
    const remap = { window: [700, 100] as const, curve: 'ease-in' as const, length: 400 };
    const played: number[] = [];
    const m = made(HISTORY);
    m.cue({ patch: line, start: 0, loop: 2, remap });
    for (let t = 0; t <= 900; t += 50) played.push(x(m, t));
    const n = made(HISTORY);
    n.cue({ patch: line, start: 0, loop: 2, remap });
    for (let t = 0; t <= 900; t += 50) {
      expect(n.project(t).probe(a).x, `read ahead to ${t}`).toBeCloseTo(
        played[t / 50] as number,
        9,
      );
      x(n, t);
    }
    for (const t of [600, 150, 850, 0]) {
      m.seek(t);
      expect(m.probe(a).x, `seek to ${t}`).toBeCloseTo(played[t / 50] as number, 9);
    }
  });

  it('agrees with play after a handle seek', () => {
    const m = made();
    const h = m.cue({ patch: line, start: 0, remap: { window: [0, 400], length: 800 } });
    x(m, 100);
    h.seek(600);
    expect(x(m, 100)).toBe(300);
    expect(x(m, 200)).toBe(350);
  });

  it('refuses a motion, and a patch with no duration and no window', () => {
    const m = made();
    expect(() =>
      m.cue({
        patch: tween<Part, Pose>('x', { from: 0, to: 1, ms: 100 }),
        remap: { window: [0, 50] },
      }),
    ).toThrow(/a motion runs by its own laws/);
    expect(() => m.cue({ patch: clock, remap: { curve: 'ease-in' } })).toThrow(/needs a window/);
    expect(() => m.cue({ patch: line, remap: { window: [0, Number.NaN] } })).toThrow(/finite/);
  });

  it('runs off lanes and off the GPU, on the general path', () => {
    const m = made({ lanes: true });
    const h = m.cue({ patch: line, start: 0, remap: { window: [0, 500] } });
    x(m, 100);
    x(m, 200);
    expect(m.describe().voices.find((v) => v.id === h.id)?.lane).toEqual({
      on: false,
      why: 'remap',
    });
  });
});

describe('an owner remap', () => {
  it('runs its children on the remapped clock, their starts counted on it', () => {
    const m = made();
    const o = m.owns({ start: 0, remap: { window: [1000, 1400], length: 200 } });
    m.cue({ patch: clock, owner: o, start: 1100 });
    expect(x(m, 25)).toBe(0);
    expect(x(m, 100)).toBe(100);
    expect(x(m, 150)).toBe(200);
    // Past the window, on at its average speed.
    expect(x(m, 300)).toBe(500);
  });

  it('places a child’s marks where the remapped clock reaches them', () => {
    const m = made();
    const o = m.owns({ start: 100, remap: { window: [0, 400], curve: 'ease-in', length: 400 } });
    const c = m.cue({ patch: line, owner: o, start: 200, remap: { window: [0, 100] } });
    const ease = curve('ease-in');
    const inv = (s: number) => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (ease(mid) * 400 < s) lo = mid;
        else hi = mid;
      }
      return 100 + hi * 400;
    };
    const marks = m.marks(0, 10_000).filter((k) => k.voice === c.id);
    expect(marks.find((k) => k.mark === 'start')?.timestamp).toBeCloseTo(inv(200), 6);
    expect(marks.find((k) => k.mark === 'end')?.timestamp).toBeCloseTo(inv(300), 6);
  });

  it('holds its children while its curve stands still', () => {
    const m = made();
    const o = m.owns({
      start: 0,
      remap: { window: [0, 200], curve: { linear: [0, [0.5, 0.25], [0.5, 0.75], 1] }, length: 400 },
    });
    m.cue({ patch: clock, owner: o, start: 0 });
    expect(x(m, 100)).toBe(100);
    expect(x(m, 200)).toBe(100);
    expect(x(m, 300)).toBe(100);
    expect(x(m, 400)).toBe(200);
  });

  it('agrees with play on a seek back and a read ahead', () => {
    const run = (m: Mix<Part, Pose>) => {
      const o = m.owns({ start: 0, remap: { window: [50, 650], curve: 'ease-out', length: 500 } });
      m.cue({ patch: line, owner: o, start: 100, remap: { window: [0, 300] } });
      m.cue({ patch: clock, owner: o, start: 300 });
    };
    const m = made(HISTORY);
    run(m);
    const played: number[] = [];
    for (let t = 0; t <= 700; t += 50) played.push(x(m, t));
    const n = made(HISTORY);
    run(n);
    for (let t = 0; t <= 700; t += 50) {
      expect(n.project(t).probe(a).x, `read ahead to ${t}`).toBeCloseTo(
        played[t / 50] as number,
        9,
      );
      x(n, t);
    }
    for (const t of [450, 100, 650, 0, 300]) {
      m.seek(t);
      expect(m.probe(a).x, `seek to ${t}`).toBeCloseTo(played[t / 50] as number, 9);
    }
  });

  it('refuses one that turns its children back, and spans and arcs', () => {
    const m = made();
    expect(() => m.owns({ remap: { window: [400, 0] } })).toThrow(/runs its children forward/);
    expect(() => m.owns({ remap: { window: [0, 400], curve: { linear: [0, 1, 0] } } })).toThrow(
      /runs its children forward/,
    );
    expect(() => m.owns({ remap: { curve: 'ease-in' } })).toThrow(/needs a window/);
    expect(() => m.span({ duration: 100, remap: { window: [0, 100] } })).toThrow(/takes no remap/);
    expect(() => m.arc({ enter: { patch: line }, remap: { window: [0, 100] } } as never)).toThrow(
      /takes no remap/,
    );
  });
});
