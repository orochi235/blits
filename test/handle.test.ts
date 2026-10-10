import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { glide, spring, tween } from '../src/motion.js';
import { patch } from '../src/patch.js';
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
