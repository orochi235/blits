import { describe, expect, it } from 'vitest';
import { mixerOf } from '../src/gpu/engine.js';
import { baseOf, ownedOf, perSubject, sampled, uniform } from '../src/gpu/weight.js';
import { input, level, mix, patch, share } from '../src/index.js';
import type { Signal } from '../src/types.js';
import type { Voice } from '../src/voice.js';
import { type C, cells, K, type P, wave } from './gpu-fixtures.js';

const c0 = cells[0] as C;
const part = (ms: number) => patch<C, P>(ms, () => ({ y: 1 }), { writes: ['y'] });
const signal = (fn: (c: C) => number) => fn as unknown as Signal<unknown>;

/** The voices that hold no others, in cue order. */
const leaves = (m: ReturnType<typeof mix<C, P>>) =>
  mixerOf(m).cued.filter((v) => v.holding === null) as Voice<C, P>[];

describe('gpu weight', () => {
  it('reads a level once, and a subject-reading signal per subject', () => {
    expect(uniform(level(0.3))).toBe(true);
    expect(uniform(input(() => 1))).toBe(true);
    expect(uniform(signal((c) => c.x))).toBe(false);
    expect(uniform(share(level(0.5), 0, 2))).toBe(false);
    expect(sampled(level(0.3))).toBe(0.3);
  });

  it('treats a signal blits did not mark as per subject, whatever its length', () => {
    const rest = (...args: C[]) => (args[0] as C).x;
    const defaulted = (c: C = { x: 0 }) => c.x;
    expect(rest.length).toBe(0);
    expect(defaulted.length).toBe(0);
    expect(uniform(signal(rest))).toBe(false);
    expect(uniform(signal(defaulted))).toBe(false);
    expect(uniform(signal(() => 1))).toBe(false);
    expect(uniform(input((c: C) => c.x) as unknown as Signal<unknown>)).toBe(false);
    expect(uniform(input(() => 1, [level(0.5)]))).toBe(false);
  });

  it('is 1 for a voice no owner holds', () => {
    const m = mix<C, P>(K);
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, weight: 0.4 });
    m.sync(100);
    const [v] = leaves(m);
    expect(ownedOf(mixerOf(m), v as Voice<C, P>)).toBe(1);
  });

  it("multiplies nested owners' weights, fades and level signals as ownedBy does", () => {
    const m = mix<C, P>(K);
    m.sync(0);
    const program = m.owns({ weight: 0.8, fade: { in: 400 } });
    const scene = m.owns({
      owner: program,
      start: 300,
      weight: level(0.5),
      fade: { in: 200, out: 200 },
    });
    m.cue({ patch: wave, subjects: cells, owner: scene });
    const mixer = mixerOf(m);
    const child = leaves(m)[0] as Voice<C, P>;
    const check = (t: number) => {
      m.sync(t);
      expect(Math.abs(ownedOf(mixer, child) - mixer.ownedBy(child, c0))).toBeLessThan(1e-12);
    };
    for (const t of [0, 150, 350, 500, 900]) check(t);
    scene.fade();
    for (const t of [1000, 1100, 1200]) check(t);
  });

  it("takes an arc's share of each part", () => {
    const m = mix<C, P>(K);
    m.sync(0);
    m.arc({
      enter: { patch: part(200), subjects: cells },
      active: { patch: part(100), subjects: cells },
      exit: { patch: part(300), subjects: cells },
      hold: 600,
      blend: 200,
    });
    const mixer = mixerOf(m);
    const parts = leaves(m);
    expect(parts.length).toBe(3);
    for (const t of [0, 100, 250, 700, 850, 1000]) {
      m.sync(t);
      for (const v of parts)
        expect(Math.abs(ownedOf(mixer, v) - mixer.ownedBy(v, c0))).toBeLessThan(1e-12);
    }
  });

  it("keeps an owner's level read for the frame, as the CPU does", () => {
    const m = mix<C, P>(K);
    m.sync(0);
    const gain = level<C>(0.5);
    const owner = m.owns({ weight: gain });
    m.cue({ patch: wave, subjects: cells, owner });
    const mixer = mixerOf(m);
    const child = leaves(m)[0] as Voice<C, P>;
    m.sync(100);
    expect(ownedOf(mixer, child)).toBe(0.5);
    expect(mixer.ownedBy(child, c0)).toBe(0.5);
    gain.set(0.25);
    expect(ownedOf(mixer, child)).toBe(0.5);
    expect(mixer.ownedBy(child, c0)).toBe(0.5);
    m.sync(200);
    expect(ownedOf(mixer, child)).toBe(0.25);
    expect(mixer.ownedBy(child, c0)).toBe(0.25);
  });

  it('gives the base the kernel needs', () => {
    const m = mix<C, P>(K);
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, weight: 0.7 });
    m.cue({ patch: wave, subjects: cells, weight: level(0.3) });
    m.cue({ patch: wave, subjects: cells, weight: (c: C) => c.x });
    m.sync(10);
    const vs = leaves(m);
    expect(vs.map(baseOf)).toEqual([0.7, 0.3, 1]);
    expect(vs.map(perSubject)).toEqual([false, false, true]);
  });
});
