import { afterEach, describe, expect, it, vi } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';
import { type Ticked, ticker } from '../src/ticker.js';

interface Pose {
  crawl: number;
}
const PART = kit<Pose>({ crawl: sum() });
const part = { id: 'a' };
const ramp = () =>
  keys<typeof part, Pose>(100, [
    { at: 0, delta: { crawl: 0 } },
    { at: 1, delta: { crawl: 10 } },
  ]);

/** A ticker on a fake animation frame: `step(t)` runs every frame waiting, at `t`. */
function harness(fps?: number) {
  const frames = new Map<number, (t: number) => void>();
  let id = 0;
  const t = ticker({
    fps,
    raf: (cb) => {
      frames.set(++id, cb);
      return id;
    },
    caf: (i) => frames.delete(i),
  });
  const step = (at: number) => {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb(at);
  };
  return { t, step, waiting: () => frames.size };
}

/** A stand-in mix whose `inert` the test sets, and which counts syncs. */
function fake(inert = true) {
  let stir: (() => void) | undefined;
  const m = {
    inert,
    synced: [] as number[],
    sync(at: number) {
      m.synced.push(at);
    },
    onStir(fn: () => void) {
      stir = fn;
      return () => {
        stir = undefined;
      };
    },
    stir: () => stir?.(),
  };
  return m satisfies Ticked;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('onStir', () => {
  it('fires once for many cues, again after a sync, and never during one', () => {
    const m = mix<typeof part, Pose>(PART);
    let calls = 0;
    m.onStir(() => calls++);
    m.cue({ patch: ramp() });
    m.cue({ patch: ramp() });
    expect(calls).toBe(1);
    m.sync(0);
    m.cue({ patch: ramp() });
    expect(calls).toBe(2);
  });

  it('does not fire for a stir inside sync, which leaves the mix not inert', () => {
    const m = mix<typeof part, Pose>(PART);
    m.cue({ patch: ramp(), hits: [{ at: 50, event: 'hit' }] });
    let took = 0;
    m.book({
      clock: () => 0,
      ahead: 1000,
      late: 1000,
      take: () => {
        took++;
        m.cue({ patch: ramp() });
        return undefined;
      },
    });
    m.sync(0);
    let calls = 0;
    m.onStir(() => calls++);
    m.sync(10);
    expect(took).toBeGreaterThan(0);
    expect(calls).toBe(0);
    expect(m.inert).toBe(false);
  });

  it('unsubscribes', () => {
    const m = mix<typeof part, Pose>(PART);
    let calls = 0;
    const off = m.onStir(() => calls++);
    off();
    m.cue({ patch: ramp() });
    expect(calls).toBe(0);
  });
});

describe('ticker', () => {
  it('syncs every mix, then each callback, with the frame timestamp', () => {
    const { t, step } = harness();
    const a = fake();
    const order: string[] = [];
    a.sync = (at) => {
      order.push(`sync ${at}`);
    };
    t.add(a);
    t.each((at) => order.push(`each ${at}`));
    step(16);
    expect(order).toEqual(['sync 16', 'each 16']);
  });

  it('sleeps once every mix is inert, and wakes when one stirs', () => {
    const { t, step, waiting } = harness();
    const a = fake(false);
    t.add(a);
    step(16);
    expect(waiting()).toBe(1);
    a.inert = true;
    step(32);
    expect(waiting()).toBe(0);
    a.stir();
    expect(waiting()).toBe(1);
    step(48);
    expect(a.synced).toEqual([16, 32, 48]);
  });

  it('wakes for a cue on a real mix and sleeps once it has played out', () => {
    const { t, step, waiting } = harness();
    const m = mix<typeof part, Pose>(PART);
    t.add(m);
    step(0);
    expect(waiting()).toBe(0);
    m.cue({ patch: ramp(), loop: 1 });
    expect(waiting()).toBe(1);
    for (let at = 16; waiting() > 0 && at < 1000; at += 16) step(at);
    expect(m.live).toBe(false);
    expect(waiting()).toBe(0);
  });

  it('holds the loop awake while stayed', () => {
    const { t, step, waiting } = harness();
    t.add(fake());
    const release = t.stay();
    step(16);
    step(32);
    expect(waiting()).toBe(1);
    release();
    release();
    step(48);
    expect(waiting()).toBe(0);
  });

  it('stops syncing a removed mix', () => {
    const { t, step } = harness();
    const a = fake(false);
    const remove = t.add(a);
    step(16);
    remove();
    a.stir();
    step(32);
    expect(a.synced).toEqual([16]);
  });

  it('keeps going past a mix or callback that throws, and throws it later', async () => {
    const { t, step } = harness();
    const a = fake(false);
    const b = fake(false);
    a.sync = () => {
      throw new Error('a');
    };
    const errors: unknown[] = [];
    const g = globalThis as unknown as { queueMicrotask: (fn: () => void) => void };
    const real = g.queueMicrotask;
    g.queueMicrotask = (fn) =>
      real(() => {
        try {
          fn();
        } catch (err) {
          errors.push(err);
        }
      });
    try {
      t.add(a);
      t.add(b);
      t.each(() => {
        throw new Error('each');
      });
      step(16);
      step(32);
      await Promise.resolve();
    } finally {
      g.queueMicrotask = real;
    }
    expect(b.synced).toEqual([16, 32]);
    expect(errors.map((e) => (e as Error).message)).toEqual(['a', 'each', 'a', 'each']);
  });

  it('stop cancels the waiting frame until something wakes it', () => {
    const { t, step, waiting } = harness();
    const a = fake(false);
    t.add(a);
    t.stop();
    expect(waiting()).toBe(0);
    a.stir();
    step(16);
    expect(a.synced).toEqual([16]);
  });

  it('caps the rate on a grid', () => {
    const { t, step } = harness(30);
    const a = fake(false);
    t.add(a);
    for (let i = 0; i <= 12; i++) step(i * (1000 / 60));
    expect(a.synced.length).toBe(7);
    expect(a.synced.map((at) => Math.round(at))).toEqual([0, 33, 67, 100, 133, 167, 200]);
  });

  it('refuses an fps that is not a finite number above 0', () => {
    expect(() => ticker({ fps: 0 })).toThrow(RangeError);
    expect(() => ticker({ fps: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('runs on a timer at 60 by default where there are no animation frames', () => {
    vi.useFakeTimers();
    const t = ticker({ grain: 'timer' });
    const a = fake(false);
    t.add(a);
    vi.advanceTimersByTime(1000);
    expect(a.synced.length).toBe(61);
    a.inert = true;
    vi.advanceTimersByTime(100);
    const n = a.synced.length;
    vi.advanceTimersByTime(1000);
    expect(a.synced.length).toBe(n);
  });

  it('runs on a timer at the fps given', () => {
    vi.useFakeTimers();
    const t = ticker({ grain: 'timer', fps: 10 });
    const a = fake(false);
    t.add(a);
    vi.advanceTimersByTime(1000);
    expect(a.synced.length).toBe(11);
  });
});
