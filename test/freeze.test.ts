import { describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import type { Setting } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const part = { id: 'a' };

/** crawl 10 at the first frame, 20 at the last. */
const ramp = () =>
  keys<Part, Pose>(100, [
    { at: 0, delta: { crawl: 10 } },
    { at: 1, delta: { crawl: 20 } },
  ]);

const settled = (p: Promise<unknown>): Promise<unknown> =>
  Promise.race([p, new Promise((r) => setTimeout(() => r('pending'), 0))]);

describe('a dry read weighs as the probe it repeats did', () => {
  it('leaves weightOf where the probe put it, frozen before the voice starts and after', () => {
    // A signal reading voice time: atRest must not hand it the unheld time.
    const byTime = (_p: Part, s: Setting) => 0.5 + 0.4 * Math.sin(s.elapsed / 40);
    const read = (rest: boolean) => {
      const m = mix<Part, Pose>(PART, { lanes: false });
      const h = m.cue({ patch: ramp(), weight: byTime, freeze: 'both', start: 100, loop: 1 });
      const seen: number[] = [];
      for (const t of [0, 50, 120, 190, 260, 300]) {
        m.sync(t);
        m.probe(part);
        if (rest) m.atRest(part);
        seen.push(h.weightOf(part));
      }
      return seen;
    };
    expect(read(true)).toEqual(read(false));
  });
});

describe('freeze before', () => {
  it('shows a waiting subject the first frame through its stagger', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, stagger: () => 100, freeze: 'before' });
    m.sync(50);
    expect(m.probe(part).crawl).toBe(10);
    m.sync(150);
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
  });

  it('shows the first frame while the voice is pending, and stays pending', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, start: 200, freeze: 'before' });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(10);
    expect(h.state).toBe('pending');
    expect(h.weightOf(part)).toBe(1);
    m.sync(250);
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
    expect(h.state).toBe('live');
  });

  it('freezes before a start an anchor has yet to fix, then plays from where it lands', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, anchor: { start: { with: 'cue' } }, freeze: 'before' });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(10);
    m.sync(40);
    expect(m.probe(part).crawl).toBe(10);
    m.announce('cue');
    m.sync(90);
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
  });

  it('fades in from the first frame it shows, not from when the subject starts', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, fade: { in: 200 }, stagger: () => 500, freeze: 'before' });
    m.sync(0);
    m.probe(part);
    m.sync(100);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
    m.sync(550);
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
  });

  it('without it, a waiting subject still shows nothing', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, stagger: () => 100 });
    m.sync(50);
    expect(m.probe(part).crawl).toBe(0);
  });

  it('steps a stateful patch to the end of its last pass and no further, and never while waiting', () => {
    const steps: number[] = [];
    const elapsed: number[] = [];
    const counter = patch<Part, Pose, { n: number }>(
      100,
      (_phase, _s, setting: Setting<{ n: number }>) => {
        elapsed.push(setting.elapsed);
        return { crawl: setting.state.n };
      },
      {
        writes: ['crawl'],
        state: () => ({ n: 0 }),
        step: (state, dt) => {
          state.n++;
          steps.push(dt);
        },
      },
    );
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: counter, loop: 1, stagger: () => 100, freeze: 'both' });
    for (const t of [0, 50, 90]) {
      m.sync(t);
      expect(m.probe(part).crawl).toBe(0);
    }
    expect(steps).toEqual([]);
    expect(elapsed).toEqual([0, 0, 0]);
    m.sync(150);
    m.probe(part);
    m.sync(250);
    m.probe(part);
    m.sync(400);
    m.probe(part);
    // One step to the end of its last pass, then none.
    expect(steps).toEqual([150, 50]);
    expect(elapsed.at(-1)).toBe(100);
  });
});

describe('freeze after', () => {
  it('shows the last frame once its passes are done, and stays frozen', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, fade: { out: 100 }, freeze: 'after' });
    m.sync(0);
    m.probe(part);
    m.sync(500);
    expect(m.probe(part).crawl).toBe(20);
    expect(h.state).toBe('frozen');
    expect(m.live).toBe(true);
    expect(await settled(h.played)).toBe(true);
    expect(await settled(h.done)).toBe('pending');
  });

  it('leaves only when faded, ramping out from the frozen frame', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, fade: { out: 100 }, freeze: 'after' });
    m.sync(0);
    m.sync(500);
    h.fade();
    m.sync(550);
    expect(m.probe(part).crawl).toBeCloseTo(10, 9);
    expect(h.state).toBe('fading');
    m.sync(600);
    expect(m.probe(part).crawl).toBe(0);
    await h.done;
    expect(h.state).toBe('done');
  });

  it('freezes each staggered subject at its own last frame', () => {
    const m = mix<Part, Pose>(PART);
    const early = { id: 'early' };
    const late = { id: 'late' };
    const h = m.cue({
      patch: ramp(),
      loop: 1,
      stagger: (s) => (s.id === 'late' ? 300 : 0),
      freeze: 'after',
    });
    m.sync(0);
    m.probe(early);
    m.probe(late);
    m.sync(350);
    expect(m.probe(early).crawl).toBe(20);
    expect(m.probe(late).crawl).toBeCloseTo(15, 9);
    expect(h.state).toBe('live');
    m.sync(450);
    expect(h.state).toBe('frozen');
    expect(m.probe(late).crawl).toBe(20);
  });

  it('plays again when sought back into its passes', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, freeze: 'after' });
    m.sync(0);
    m.sync(200);
    expect(h.state).toBe('frozen');
    h.seek(50);
    m.sync(210);
    expect(h.state).toBe('live');
    expect(m.probe(part).crawl).toBeCloseTo(16, 9);
  });

  it('leaves its out and end unfixed until faded, so a voice after it waits', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, freeze: 'after', name: 'spin' });
    const next = m.cue({ patch: ramp(), loop: 1, anchor: { start: { after: 'spin' } } });
    m.sync(0);
    m.sync(500);
    expect(next.state).toBe('pending');
    expect(
      m
        .marks(0, 10_000)
        .filter((k) => k.voice === h.id)
        .map((k) => k.mark),
    ).toEqual(['start', 'in']);
    h.fade();
    m.sync(510);
    expect(next.state).toBe('live');
  });

  it('fades at an anchored out', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1, freeze: 'after', anchor: { out: 400 } });
    m.sync(0);
    m.sync(200);
    expect(h.state).toBe('frozen');
    m.sync(400);
    expect(h.state).toBe('done');
  });

  it('does nothing to a voice that loops for good', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), freeze: 'after' });
    m.sync(0);
    m.sync(250);
    expect(h.state).toBe('live');
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
  });

  it('a projection ahead reads the frozen frame', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: ramp(), loop: 1, freeze: 'after' });
    m.sync(0);
    m.probe(part);
    expect(m.project(1000).probe(part).crawl).toBe(20);
  });

  it('a projection back reads the frozen frame', () => {
    const m = mix<Part, Pose>(PART, { history: { ms: 10_000 } });
    const h = m.cue({ patch: ramp(), loop: 1, freeze: 'after', fade: { out: 0 } });
    m.sync(0);
    m.probe(part);
    m.sync(300);
    m.probe(part);
    m.sync(400);
    h.fade();
    m.sync(500);
    expect(m.probe(part).crawl).toBe(0);
    expect(m.project(300).probe(part).crawl).toBe(20);
  });
});

describe('played', () => {
  it('resolves true when a finite loop plays out without a freeze', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 1 });
    m.sync(0);
    m.sync(200);
    expect(await h.played).toBe(true);
  });

  it('resolves false when the voice leaves before its last pass ends', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp(), loop: 2, freeze: 'after' });
    m.sync(0);
    m.sync(50);
    h.fade({ over: 0 });
    m.sync(60);
    expect(await h.played).toBe(false);
  });

  it('resolves false for a voice that loops for good, once it leaves', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: ramp() });
    m.sync(0);
    m.sync(500);
    expect(await settled(h.played)).toBe('pending');
    h.fade({ over: 0 });
    m.sync(510);
    expect(await h.played).toBe(false);
  });
});

describe('hold, the deprecated name for freeze', () => {
  it('still freezes, and freeze wins where both are set', () => {
    const m = mix<Part, Pose>(PART);
    const old = m.cue({ patch: ramp(), loop: 1, hold: 'after' });
    const both = m.cue({ patch: ramp(), loop: 1, hold: 'after', freeze: 'before' });
    m.sync(0);
    m.probe(part);
    m.sync(200);
    m.probe(part);
    m.sync(210);
    expect(old.state).toBe('frozen');
    expect(both.state).not.toBe('frozen');
  });
});
