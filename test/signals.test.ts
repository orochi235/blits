import { describe, expect, it } from 'vitest';
import { hex, mul, rig, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { gate, level, peak, slew } from '../src/signals.js';
import type { Setting } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  color: number;
}
const PART = rig<Pose>({ gain: mul(), crawl: sum(), color: hex() });
interface Part {
  id: string;
}
const part = { id: 'a' };

const frame = (now: number, dt: number): Setting => ({
  now,
  dt,
  elapsed: now,
  pass: 0,
  weight: 0,
  state: undefined as never,
  host: undefined,
});

describe('band quiet', () => {
  it('a signal held inside a gate band for a whole pass produces no switch', () => {
    const input = level<Part>(0.9);
    const held = gate<Part>(input, { on: 0.6, off: 0.4 });
    expect(held(part, frame(0, 0))).toBe(1);

    const wander = [0.55, 0.45, 0.59, 0.41, 0.5, 0.58];
    wander.forEach((v, i) => {
      input.set(v);
      expect(held(part, frame(16 * (i + 1), 16))).toBe(1);
    });

    input.set(0.3);
    expect(held(part, frame(200, 16))).toBe(0);
    input.set(0.5);
    expect(held(part, frame(216, 16))).toBe(0);
  });

  it("a rest-less channel's influence holds inside the band rather than flickering", () => {
    const k = level<Part>(1);
    const m = mix<Part, Pose>(PART, { band: { on: 0.6, off: 0.4 } });
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ color: 0x00ff00 }), { writes: ['color'] }),
      weight: k,
    });
    m.sync(0);
    expect(m.sample(part).color).toBe(0x00ff00);

    for (const [i, w] of [0.55, 0.45, 0.58, 0.42].entries()) {
      k.set(w);
      m.sync(16 * (i + 1));
      expect(m.sample(part).color).toBe(0x00ff00);
    }

    k.set(0.2);
    m.sync(100);
    expect(m.sample(part).color).toBeUndefined();
  });
});

describe('slew', () => {
  it('follows its input no faster than the rate limit, and snaps on an infinite dt', () => {
    const input = level<Part>(0);
    const followed = slew<Part>(input, { riseMs: 100, fallMs: 200 });
    expect(followed(part, frame(0, 0))).toBe(0);

    input.set(1);
    expect(followed(part, frame(50, 50))).toBeCloseTo(0.5, 9);
    expect(followed(part, frame(100, 50))).toBeCloseTo(1, 9);

    input.set(0);
    expect(followed(part, frame(150, 50))).toBeCloseTo(0.75, 9);

    expect(followed(part, frame(200, Number.POSITIVE_INFINITY))).toBe(0);
  });

  it('answers twice in one frame with one value, so a wrapper probing twice costs nothing', () => {
    const input = level<Part>(1);
    const followed = slew<Part>(input, { riseMs: 100 });
    followed(part, frame(0, 0));
    const first = followed(part, frame(50, 50));
    const second = followed(part, frame(50, 50));
    expect(second).toBe(first);
  });

  it('state belongs to the instance, so two readers share it and two instances do not', () => {
    const input = level<Part>(0);
    const shared = slew<Part>(input, { riseMs: 100 });
    shared(part, frame(0, 0));
    input.set(1);
    // One instance, read by two callers in the same frame: one answer, and it is rate-limited.
    expect(shared(part, frame(50, 50))).toBeCloseTo(0.5, 9);
    expect(shared(part, frame(50, 50))).toBeCloseTo(0.5, 9);
    // A second instance has its own state, and first sight snaps to the input.
    const separate = slew<Part>(input, { riseMs: 100 });
    expect(separate(part, frame(50, 50))).toBe(1);
  });
});

describe('peak', () => {
  it('is the loudest of its inputs', () => {
    const a = level<Part>(0.2);
    const b = level<Part>(0.7);
    expect(peak(a, b)(part, frame(0, 0))).toBe(0.7);
    b.set(0.1);
    expect(peak(a, b)(part, frame(16, 16))).toBe(0.2);
  });
});
