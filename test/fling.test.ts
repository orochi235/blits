import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { fling, type PointerLike, type PointerTarget, track } from '../src/fling.js';
import { mix } from '../src/mixer.js';
import { glide } from '../src/motion.js';

describe('track', () => {
  it('reads a steady pointer at its speed, in units per second', () => {
    const t = track();
    for (let ms = 0; ms <= 80; ms += 16) t.add(ms, ms * 2);
    expect(t.velocity()).toBeCloseTo(2000, 9);
  });

  it('reads only the last ms of samples', () => {
    const t = track({ ms: 50 });
    for (let ms = 0; ms <= 200; ms += 10) t.add(ms, ms < 100 ? 0 : (ms - 100) * 3);
    expect(t.velocity()).toBeCloseTo(3000, 9);
  });

  it('reads zero once the pointer sat still longer than stop before letting go', () => {
    const t = track({ stop: 40 });
    t.add(0, 0);
    t.add(16, 10);
    expect(t.velocity(56)).toBeCloseTo(625, 9);
    expect(t.velocity(57)).toBe(0);
  });

  it('reads zero with fewer than two samples, and after clear', () => {
    const t = track();
    expect(t.velocity()).toBe(0);
    t.add(0, 5);
    expect(t.velocity()).toBe(0);
    t.add(10, 6);
    t.clear();
    expect(t.velocity()).toBe(0);
  });

  it('reads each axis of an array on its own', () => {
    const t = track<number[]>();
    t.add(0, [0, 0]);
    t.add(10, [1, -2]);
    const [x, y] = t.velocity();
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(-200, 9);
  });

  it('refuses a ms that is not positive', () => {
    expect(() => track({ ms: 0 })).toThrow(RangeError);
  });
});

/** A stand-in element: it records listeners and lets the test fire pointer events at them. */
function stage() {
  const fns = new Map<string, Set<(e: PointerLike) => void>>();
  const captured: number[] = [];
  const target: PointerTarget = {
    addEventListener(type, fn) {
      if (!fns.has(type)) fns.set(type, new Set());
      fns.get(type)?.add(fn);
    },
    removeEventListener(type, fn) {
      fns.get(type)?.delete(fn);
    },
    setPointerCapture(id) {
      captured.push(id);
    },
  };
  const fire = (type: string, timeStamp: number, clientY: number, clientX = 0, pointerId = 1) => {
    for (const fn of fns.get(type) ?? []) fn({ pointerId, clientX, clientY, timeStamp });
  };
  return { target, fire, captured, fns };
}

interface Pose {
  y: number;
  p: number[];
}
const K = kit<Pose>({ y: sum(), p: vec(2, sum()) });
const page = { id: 'page' };

describe('fling', () => {
  it('drags a glide under the pointer, then coasts it on from the release velocity', () => {
    const g = glide<typeof page, Pose>('y', { from: 100, ms: 325, settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    const { target, fire, captured } = stage();
    fling(target, g, page, { scale: -1 });
    fire('pointerdown', 0, 500);
    expect(captured).toEqual([1]);
    for (let t = 16; t <= 64; t += 16) {
      m.sync(t);
      fire('pointermove', t, 500 - t);
      expect(m.probe(page).y).toBe(100 + t);
    }
    fire('pointerup', 64, 436);
    m.sync(10_000);
    expect(m.probe(page).y).toBeCloseTo(164 + 1000 * 0.325, 6);
  });

  it('catches a coasting glide where it is on a press', () => {
    const g = glide<typeof page, Pose>('y', { from: 0, velocity: 2000, ms: 325, settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    m.sync(100);
    const there = m.probe(page).y;
    const { target, fire } = stage();
    fling(target, g, page);
    fire('pointerdown', 100, 0);
    fire('pointerup', 300, 0);
    m.sync(10_000);
    expect(m.probe(page).y).toBeCloseTo(there, 6);
  });

  it('lets go at rest on a cancel, and ignores a second pointer', () => {
    const g = glide<typeof page, Pose>('y', { from: 0, settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    const { target, fire } = stage();
    fling(target, g, page);
    fire('pointerdown', 0, 0);
    fire('pointerdown', 5, 900, 0, 2);
    fire('pointermove', 10, 900, 0, 2);
    fire('pointermove', 16, 40);
    fire('pointercancel', 20, 40);
    m.sync(10_000);
    expect(m.probe(page).y).toBe(40);
  });

  it('moves a subject on both axes with xy', () => {
    const g = glide<typeof page, Pose, number[]>('p', { from: [0, 0], ms: 200, settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    const { target, fire } = stage();
    fling(target, g, page, { axis: 'xy' });
    fire('pointerdown', 0, 0, 0);
    fire('pointermove', 10, -2, 1);
    fire('pointerup', 10, -2, 1);
    m.sync(10_000);
    const [x, y] = m.probe(page).p as number[];
    expect(x).toBeCloseTo(1 + 100 * 0.2, 6);
    expect(y).toBeCloseTo(-2 - 200 * 0.2, 6);
  });

  it('follows less of a drag past an edge, never more than give past, and springs back on release', () => {
    const g = glide<typeof page, Pose>('y', { from: 0, bounds: [0, 1000], settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    const { target, fire } = stage();
    fling(target, g, page, { give: 80 });
    fire('pointerdown', 0, 0);
    let last = 0;
    for (let t = 16; t <= 160; t += 16) {
      m.sync(t);
      fire('pointermove', t, -t * 4);
      const y = m.probe(page).y;
      expect(y).toBeLessThan(0);
      expect(y).toBeGreaterThan(-80);
      expect(y).toBeLessThan(last);
      expect(-y).toBeLessThan(t * 4 * 0.55 + 1e-9);
      last = y;
    }
    m.sync(1000);
    expect(m.probe(page).y).toBe(last);
    fire('pointerup', 1000, -640);
    m.sync(10_000);
    expect(m.probe(page).y).toBeCloseTo(0, 6);
  });

  it('holds the subject at the edge with a give of 0', () => {
    const g = glide<typeof page, Pose>('y', { from: 50, bounds: [0, 100], settle: 0 });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    const { target, fire } = stage();
    fling(target, g, page, { give: 0 });
    fire('pointerdown', 0, 0);
    m.sync(16);
    fire('pointermove', 16, 300);
    expect(m.probe(page).y).toBe(100);
  });

  it('holds a subject caught springing back past an edge where it is, and drags it on from there', () => {
    const g = glide<typeof page, Pose>('y', { from: 0, velocity: 3000, bounds: [0, 200] });
    const m = mix<typeof page, Pose>(K);
    m.cue({ patch: g });
    m.sync(0);
    m.probe(page);
    m.sync(400);
    const there = m.probe(page).y;
    expect(there).toBeGreaterThan(200);
    const { target, fire } = stage();
    fling(target, g, page);
    fire('pointerdown', 400, 0);
    m.sync(2000);
    expect(m.probe(page).y).toBeCloseTo(there, 9);
    m.sync(2010);
    fire('pointermove', 2010, 0);
    expect(m.probe(page).y).toBeCloseTo(there, 9);
    m.sync(2020);
    fire('pointermove', 2020, 5);
    expect(m.probe(page).y).toBeGreaterThan(there);
  });

  it('removes its listeners when told to', () => {
    const g = glide<typeof page, Pose>('y', { from: 0 });
    const { target, fns } = stage();
    const off = fling(target, g, page);
    off();
    for (const set of fns.values()) expect(set.size).toBe(0);
  });
});
