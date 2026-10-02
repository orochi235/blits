import { describe, expect, it } from 'vitest';
import { hex, kit, mul, sum } from '../src/channels.js';
import { mix, mixer } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import type { Engine, Kit, Mix, MixOptions } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum() });
interface Part {
  id: string;
}
const part = { id: 'a' };

describe('declared writes', () => {
  it('a patch sets no key outside its writes, on every subject and every pass', () => {
    const p = patch<Part, Pose>(100, (phase) => ({ crawl: phase * 10 }), { writes: ['crawl'] });
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: p });
    for (const now of [0, 25, 50, 125, 250]) {
      m.sync(now);
      for (const subject of [{ id: 'a' }, { id: 'b' }]) {
        const delta = p.at((now % 100) / 100, subject, {
          timestamp: now,
          dt: 16,
          elapsed: now,
          pass: 0,
          weight: 1,
          state: undefined,
          host: undefined,
          keep: (_owner, init) => init(),
          send: () => {},
        });
        for (const key of Object.keys(delta)) expect(p.writes).toContain(key);
      }
    }
  });

  it('a voice whose patch writes a channel the kit lacks throws at cue, naming both', () => {
    const stray = patch<Part, { rogue: number }, void>(0, () => ({ rogue: 1 }), {
      writes: ['rogue'],
    });
    const m = mix<Part, Pose>(PART);
    expect(() => m.cue({ patch: stray as never })).toThrow(/rogue/);
  });

  it('a keys patch derives its writes from its stops', () => {
    const k = keys<Part, Pose>(100, [
      { at: 0, delta: { crawl: 0 } },
      { at: 1, delta: { crawl: 10, gain: 0.5 } },
    ]);
    expect([...k.writes].sort()).toEqual(['crawl', 'gain']);
  });
});

describe('engine refusal', () => {
  const baked: Engine = {
    name: 'baked',
    runs: new Set<'fn' | 'keys'>(['keys']),
    // A wrapping engine hands its own identity down, so the refusal names the engine a host chose.
    create<I, O>(r: Kit<O>, opts: MixOptions): Mix<I, O> {
      return mixer.create<I, O>(r, { ...opts, engine: baked });
    },
  };

  it('an engine whose runs lacks fn throws at cue, naming the engine', () => {
    const m = mix<Part, Pose>(PART, { engine: baked });
    const procedural = patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] });
    expect(() => m.cue({ patch: procedural })).toThrow(/baked/);
  });

  it('and runs the form it does declare', () => {
    const m = mix<Part, Pose>(PART, { engine: baked });
    const declarative = keys<Part, Pose>(100, [
      { at: 0, delta: { crawl: 0 } },
      { at: 1, delta: { crawl: 10 } },
    ]);
    expect(() => m.cue({ patch: declarative })).not.toThrow();
  });

  it('refuses a motion patch on an engine that runs keys only', () => {
    const m = mix<Part, Pose>(PART, { engine: baked });
    expect(() => m.cue({ patch: spring<Part, Pose>('crawl', { to: 1 }) })).toThrow(/motion/);
  });
});

describe('target', () => {
  it('runs per subject on first sight, including subjects that did not exist at cue', () => {
    const asked: string[] = [];
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 5 }), { writes: ['crawl'] }),
      target: (subject) => {
        asked.push(subject.id);
        return subject.id !== 'skipped';
      },
    });
    m.sync(0);
    expect(m.probe({ id: 'a' }).crawl).toBe(5);
    expect(m.probe({ id: 'skipped' }).crawl).toBe(0);

    m.sync(16);
    const born = { id: 'later' };
    expect(m.probe(born).crawl).toBe(5);
    expect(asked).toEqual(['a', 'skipped', 'later']);
  });

  it('keeps the answer, so the predicate runs once per subject', () => {
    let calls = 0;
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 5 }), { writes: ['crawl'] }),
      target: () => {
        calls++;
        return true;
      },
    });
    for (const now of [0, 16, 32]) {
      m.sync(now);
      m.probe(part);
    }
    expect(calls).toBe(1);
  });
});

describe('stagger', () => {
  it('delays a voice per subject without moving anything else', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(1000, (phase) => ({ crawl: phase * 100 }), { writes: ['crawl'] }),
      stagger: (subject) => (subject.id === 'late' ? 100 : 0),
    });
    m.sync(200);
    expect(m.probe({ id: 'early' }).crawl).toBeCloseTo(20, 9);
    expect(m.probe({ id: 'late' }).crawl).toBeCloseTo(10, 9);
  });

  it('a subject whose stagger has not elapsed contributes nothing yet', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(1000, () => ({ crawl: 50 }), { writes: ['crawl'] }),
      stagger: () => 100,
    });
    m.sync(50);
    expect(m.probe(part).crawl).toBe(0);
    m.sync(150);
    expect(m.probe(part).crawl).toBe(50);
  });

  it('a fade in starts when the subject does, not when the voice does', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 10 }), { writes: ['crawl'] }),
      start: 0,
      fade: { in: 200 },
      stagger: () => 500,
    });
    m.sync(600);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
    m.sync(700);
    expect(m.probe(part).crawl).toBeCloseTo(10, 9);
  });

  it('a fade in under a rate starts where the voice clock reaches the delay', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 10 }), { writes: ['crawl'] }),
      start: 0,
      rate: 2,
      fade: { in: 200 },
      stagger: () => 500,
    });
    m.sync(0);
    m.probe(part);
    m.sync(350);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
  });

  it('asks stagger once per subject and keeps the answer', () => {
    let asked = 0;
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] }),
      stagger: () => {
        asked++;
        return 0;
      },
    });
    for (let t = 0; t < 5; t++) {
      m.sync(t * 16);
      m.probe(part);
    }
    expect(asked).toBe(1);
  });
});

describe('the mix as a host sees it', () => {
  it('live goes false when nothing is left and true again on the next cue', () => {
    const m = mix<Part, Pose>(PART);
    expect(m.live).toBe(false);
    const h = m.cue({ patch: patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] }) });
    expect(m.live).toBe(true);
    h.fade();
    m.sync(0);
    expect(m.live).toBe(false);
    m.cue({ patch: patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] }) });
    expect(m.live).toBe(true);
  });

  it('a reused out object carries nothing from one subject to the next', () => {
    const m = mix<Part, { gain: number; color?: number }>(kit({ gain: mul(), color: hex() }));
    const a = { id: 'a' };
    m.cue({
      patch: patch<Part, { gain: number; color?: number }>(0, () => ({ color: 0xff0000 }), {
        writes: ['color'],
      }),
      target: (subject) => subject === a,
    });
    m.sync(1);
    const scratch = {} as { gain: number; color?: number };
    expect(m.probe(a, scratch).color).toBe(0xff0000);
    expect(m.probe({ id: 'b' }, scratch)).toEqual({ gain: 1 });
  });

  it('drop forgets a subject, so its state is built again on next sight', () => {
    let built = 0;
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose, { n: number }>(0, () => ({ crawl: 1 }), {
        writes: ['crawl'],
        state: () => {
          built++;
          return { n: 0 };
        },
      }),
    });
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    expect(built).toBe(1);
    m.drop(part);
    m.sync(32);
    m.probe(part);
    expect(built).toBe(2);
  });

  it('a finite loop plays its passes, holds its last value, then leaves', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({
      patch: patch<Part, Pose>(100, (phase) => ({ crawl: phase * 10 }), { writes: ['crawl'] }),
      loop: 2,
    });
    m.sync(0);
    m.probe(part);
    m.sync(150);
    expect(m.probe(part).crawl).toBeCloseTo(5, 9);
    m.sync(250);
    m.probe(part);
    expect(m.live).toBe(false);
    await h.done;
    expect(h.state).toBe('done');
  });
});

describe('a finite loop under stagger', () => {
  it('stays until the latest subject it has seen has played its passes', () => {
    const m = mix<Part, Pose>(PART);
    const early = { id: 'early' };
    const late = { id: 'late' };
    m.cue({
      patch: patch<Part, Pose>(100, (phase) => ({ crawl: phase * 10 }), { writes: ['crawl'] }),
      loop: 1,
      stagger: (s) => (s.id === 'late' ? 300 : 0),
    });
    for (let t = 0; t <= 350; t += 50) {
      m.sync(t);
      m.probe(early);
      m.probe(late);
    }
    expect(m.probe(late).crawl).toBeCloseTo(5, 9);
    expect(m.live).toBe(true);
    m.sync(450);
    expect(m.live).toBe(false);
  });
});
