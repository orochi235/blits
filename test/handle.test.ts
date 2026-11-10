import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it, vi } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { level } from '../src/signals.js';
import type { Handle } from '../src/types.js';

interface Pose {
  x: number;
  p: number[];
}
const K = kit<Pose>({ x: sum(), p: vec(2, sum()) });
interface Part {
  id: string;
}
const a = { id: 'a' };
const FRAMES = [0, 16, 100, 250, 400, 700];

/** `x` at each frame, with `act` run on the frame at 100. */
function play(cued: (m: ReturnType<typeof mix<Part, Pose>>) => () => void): number[] {
  const m = mix<Part, Pose>(K);
  const act = cued(m);
  return FRAMES.map((t) => {
    m.sync(t);
    const x = m.probe(a).x;
    if (t === 100) act();
    return x;
  });
}

describe('a handle reaches its voice’s motion patch', () => {
  it('to retargets a tween as the patch’s own to does', () => {
    const make = () => tween<Part, Pose>('x', { from: 0, to: 10, ms: 300 });
    const byPatch = play((m) => {
      const p = make();
      m.cue({ patch: p });
      return () => p.to(a, -5);
    });
    const byHandle = play((m) => {
      const h = m.cue({ patch: make() });
      return () => h.to(a, -5);
    });
    expect(byHandle).toEqual(byPatch);
    expect(byHandle[5]).toBeCloseTo(-5, 9);
  });

  it('push sets a glide moving as the patch’s own push does, and read reports it', () => {
    const make = () => glide<Part, Pose>('x', { from: 1 });
    let seen: unknown;
    const byPatch = play((m) => {
      const p = make();
      m.cue({ patch: p });
      return () => p.push(a, 40);
    });
    const byHandle = play((m) => {
      const h = m.cue({ patch: make() });
      return () => {
        h.push(a, 40);
        seen = h.read(a);
      };
    });
    expect(byHandle).toEqual(byPatch);
    expect(byHandle[5]).toBeGreaterThan(1);
    expect(seen).toEqual({ value: 1, velocity: 40 });
  });

  it('set puts a glide where the patch’s own set does', () => {
    const make = () => glide<Part, Pose>('x', { from: 1, velocity: 30 });
    const byPatch = play((m) => {
      const p = make();
      m.cue({ patch: p });
      return () => p.set(a, -8);
    });
    const byHandle = play((m) => {
      const h = m.cue({ patch: make() });
      return () => h.set(a, -8);
    });
    expect(byHandle).toEqual(byPatch);
  });

  it('a spring takes both, on every axis, at a time given', () => {
    const m = mix<Part, Pose>(K);
    const h = m.cue({ patch: spring<Part, Pose, number[]>('p', { from: [0, 0], to: [0, 0] }) });
    m.sync(0);
    m.probe(a);
    h.to(a, [4, -2], 0);
    h.push(a, [10, 0], 0);
    expect(h.read(a, 0)).toEqual({ value: [0, 0], velocity: [10, 0] });
    m.sync(5000);
    const p = m.probe(a).p;
    expect(p[0]).toBeCloseTo(4, 3);
    expect(p[1]).toBeCloseTo(-2, 3);
  });

  it('throws for a voice whose patch does not take the call, and reads undefined', () => {
    const m = mix<Part, Pose>(K);
    const plain = m.cue({ patch: patch<Part, Pose>(0, () => ({ x: 1 }), { writes: ['x'] }) });
    const gliding = m.cue({ patch: glide<Part, Pose>('x', { from: 0 }) });
    const tweening = m.cue({ patch: tween<Part, Pose>('x', { from: 0, to: 1, ms: 100 }) });
    const owner = m.owns({});
    m.sync(0);
    expect(() => plain.to(a, 1)).toThrow(/to needs a voice playing a spring or a tween/);
    expect(() => plain.push(a, 1)).toThrow(/push needs a voice playing a spring or a glide/);
    expect(() => plain.set(a, 1)).toThrow(/set needs a voice playing a motion patch/);
    expect(() => gliding.to(a, 1)).toThrow(/a spring or a tween/);
    expect(() => tweening.push(a, 1)).toThrow(/a spring or a glide/);
    expect(() => owner.to(a, 1)).toThrow();
    expect(plain.read(a)).toBeUndefined();
    expect(owner.read(a)).toBeUndefined();
  });

  it('a seek plays a handle’s retarget again', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
    const h: Handle<Part> = m.cue({ patch: tween<Part, Pose>('x', { from: 0, to: 10, ms: 300 }) });
    const first = FRAMES.map((t) => {
      m.sync(t);
      const x = m.probe(a).x;
      if (t === 100) h.to(a, -5);
      return x;
    });
    m.seek(0);
    const again = FRAMES.map((t) => {
      // The host's clock goes on from 700, and the mix reads the time since the seek.
      if (t > 0) m.sync(700 + t);
      return m.probe(a).x;
    });
    again.forEach((x, i) => {
      expect(x).toBeCloseTo(first[i] as number, 9);
    });
    expect(again[5]).toBe(-5);
  });
});

const ten = () => patch<Part, Pose>(Infinity, () => ({ x: 10 }), { writes: ['x'] });

describe('a weight write on a signal-weighted voice multiplies into the signal', () => {
  it('scales the probe, clamped to 0..1, and warns nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const m = mix<Part, Pose>(K);
      const h = m.cue({ name: 'weighted', patch: ten(), weight: level<Part>(0.5) });
      m.sync(0);
      expect(m.probe(a).x).toBeCloseTo(5, 9);
      h.weight = 0.5;
      expect(h.weight).toBe(0.5);
      m.sync(16);
      expect(m.probe(a).x).toBeCloseTo(2.5, 9);
      expect(h.weightOf(a)).toBeCloseTo(0.25, 9);
      h.weight = 4;
      m.sync(32);
      expect(m.probe(a).x).toBeCloseTo(10, 9);
      h.weight = 0;
      m.sync(48);
      expect(m.probe(a).x).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('agrees on lanes and off, for a patch, a keys voice, a tween, and a crowd', () => {
    interface Id {
      id: number;
    }
    const subjects = Array.from({ length: 24 }, (_, id) => ({ id }));
    const run = (lanes: boolean) => {
      const m = mix<Id, Pose>(K, { lanes });
      const by = (s: Id) => (s.id % 4) / 4;
      const plain = m.cue({
        patch: patch<Id, Pose>(Infinity, () => ({ x: 1 }), { writes: ['x'] }),
        subjects,
        weight: by,
      });
      const keyed = m.cue({
        patch: keys<Id, Pose>(Infinity, [{ at: 0, delta: { x: 100 } }]),
        subjects,
        weight: level<Id>(0.5),
      });
      const tweened = m.cue({
        patch: tween<Id, Pose>('x', { from: 0, to: 10_000, ms: 1000, ease: 'linear' }),
        subjects,
        weight: by,
      });
      const crowded = m.cue({
        patch: patch<Id, Pose>(Infinity, () => ({ x: 1_000_000 }), { writes: ['x'] }),
        subjects: [subjects[5] as Id],
        weight: level<Id>(1),
      });
      const frames: number[][] = [];
      for (const t of [0, 16, 32, 48, 64]) {
        if (t === 32) {
          plain.weight = 0.5;
          keyed.weight = 0.25;
          tweened.weight = 2;
          crowded.weight = 0.5;
        }
        m.sync(t);
        frames.push(subjects.map((s) => m.probe(s).x));
      }
      const laned = (m as unknown as { lanes: { laned: unknown[] } | null }).lanes;
      return { frames, laned: laned === null ? 0 : laned.laned.length };
    };
    const on = run(true);
    const off = run(false);
    expect(on.laned).toBeGreaterThan(0);
    on.frames.forEach((row, i) => {
      row.forEach((x, j) => {
        expect(x).toBeCloseTo((off.frames[i] as number[])[j] as number, 6);
      });
    });
    const last = on.frames[4] as number[];
    const tweenAt = 10_000 * 0.064;
    for (const [j, x] of last.entries()) {
      const k = (j % 4) / 4;
      const expected =
        0.5 * k + 100 * 0.125 + tweenAt * Math.min(1, 2 * k) + (j === 5 ? 500_000 : 0);
      expect(x).toBeCloseTo(expected, 6);
    }
  });

  it("multiplies a blend member's written weight into its share, on lanes and off", () => {
    const subjects = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}` }));
    const run = (lanes: boolean) => {
      const m = mix<Part, Pose>(K, { lanes });
      const at = (x: number) => patch<Part, Pose>(Infinity, () => ({ x }), { writes: ['x'] });
      const [, second] = m.blend([at(0), at(10)], level<Part>(0.5), { subjects });
      const out: number[][] = [];
      for (const t of [0, 16, 32, 48]) {
        if (t === 32 && second !== undefined) second.weight = 0.5;
        m.sync(t);
        out.push(subjects.map((s) => m.probe(s).x));
      }
      return { out, share: second?.weightOf(subjects[3] as Part) };
    };
    const on = run(true);
    const off = run(false);
    expect(on.share).toBeCloseTo(0.25, 9);
    expect(off.share).toBeCloseTo(0.25, 9);
    on.out.forEach((row, i) => {
      row.forEach((x, j) => {
        expect(x).toBeCloseTo((off.out[i] as number[])[j] as number, 9);
      });
    });
    expect(on.out[3]?.[0]).not.toBeCloseTo(on.out[0]?.[0] as number, 6);
  });

  it("multiplies an owner's written weight into its signal for every child", () => {
    const m = mix<Part, Pose>(K);
    const owner = m.owns({ weight: level<Part>(0.5) });
    m.cue({ patch: ten(), owner });
    m.sync(0);
    expect(m.probe(a).x).toBeCloseTo(5, 9);
    owner.weight = 0.5;
    m.sync(16);
    expect(m.probe(a).x).toBeCloseTo(2.5, 9);
  });

  it('a seek back restores the weight before the write, and plays the write again', () => {
    const m = mix<Part, Pose>(K, { history: { ms: 10_000, tape } });
    const h = m.cue({ patch: ten(), weight: level<Part>(0.5) });
    const first = FRAMES.map((t) => {
      m.sync(t);
      if (t === 100) h.weight = 0.5;
      return m.probe(a).x;
    });
    expect(first[1]).toBeCloseTo(5, 9);
    expect(first[2]).toBeCloseTo(2.5, 9);
    m.seek(50);
    expect(h.weight).toBe(1);
    expect(m.probe(a).x).toBeCloseTo(5, 9);
    m.seek(0);
    const again = FRAMES.map((t) => {
      if (t > 0) m.sync(700 + t);
      return m.probe(a).x;
    });
    again.forEach((x, i) => {
      expect(x).toBeCloseTo(first[i] as number, 9);
    });
  });
});
