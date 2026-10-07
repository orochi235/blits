import { beforeEach, describe, expect, it } from 'vitest';
import { kit, mul, sum } from '../src/channels.js';
import { hex } from '../src/color.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { gate, lag, level, peak, slew } from '../src/signals.js';
import type { Setting } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  color: number;
}
const PART = kit<Pose>({ gain: mul(), crawl: sum(), color: hex() });
interface Part {
  id: string;
}
const part = { id: 'a' };

// One voice and one subject's worth of kept state, as the mix would hold it.
let kept = new Map<object, unknown>();
beforeEach(() => {
  kept = new Map();
});
const frame = (now: number, dt: number): Setting => ({
  timestamp: now,
  dt,
  elapsed: now,
  pass: 0,
  weight: 0,
  state: undefined as never,
  host: undefined,
  keep: (owner, init) => {
    if (!kept.has(owner)) kept.set(owner, init());
    return kept.get(owner) as never;
  },
  send: () => {},
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
    expect(m.probe(part).color).toBe(0x00ff00);

    for (const [i, w] of [0.55, 0.45, 0.58, 0.42].entries()) {
      k.set(w);
      m.sync(16 * (i + 1));
      expect(m.probe(part).color).toBe(0x00ff00);
    }

    k.set(0.2);
    m.sync(100);
    expect(m.probe(part).color).toBeUndefined();
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

  it('starts at from on first sight and climbs from there, not from its input', () => {
    const followed = slew<Part>(level<Part>(1), { riseMs: 100, from: 0 });
    expect(followed(part, frame(0, 0))).toBe(0);
    expect(followed(part, frame(50, 50))).toBeCloseTo(0.5, 9);
    expect(followed(part, frame(100, 50))).toBeCloseTo(1, 9);
  });

  it('lag starts at from too, and closes the exponential share of the way from it', () => {
    const followed = lag<Part>(level<Part>(1), { riseMs: 100, from: 0, floor: 0 });
    expect(followed(part, frame(0, 0))).toBe(0);
    expect(followed(part, frame(100, 100))).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('starts on its input rather than at from when dt is infinite', () => {
    const inf = Number.POSITIVE_INFINITY;
    expect(slew<Part>(level<Part>(1), { riseMs: 100, from: 0 })(part, frame(0, inf))).toBe(1);
    kept = new Map();
    expect(lag<Part>(level<Part>(1), { riseMs: 100, from: 0 })(part, frame(0, inf))).toBe(1);
  });

  it('a mix under reduced motion shows a from-started slew on its input from the first frame', () => {
    const crawl = patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] });
    const m = mix<Part, Pose>(PART, { reduce: true });
    m.cue({ patch: crawl, weight: slew<Part>(level<Part>(1), { riseMs: 100, from: 0 }) });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(1);
  });

  it('answers twice in one frame with one value, so a wrapper probing twice costs nothing', () => {
    const input = level<Part>(1);
    const followed = slew<Part>(input, { riseMs: 100 });
    followed(part, frame(0, 0));
    const first = followed(part, frame(50, 50));
    const second = followed(part, frame(50, 50));
    expect(second).toBe(first);
  });

  it('state belongs to the voice reading it, so two voices handed one slew follow on their own', () => {
    const input = level<Part>(0);
    const shared = slew<Part>(input, { riseMs: 100 });
    const gain = patch<Part, Pose>(0, () => ({ gain: 0 }), { writes: ['gain'] });
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: gain, weight: shared });
    m.sync(0);
    m.probe(part);
    input.set(1);
    m.cue({ patch: gain, weight: shared, start: 50 });
    m.sync(50);
    // The first voice is halfway up and the second, seeing the part for the first time, snaps to
    // 1: gain is (1 − 0.5)(1 − 1). One shared state would read 0.5 for both, and 0.25.
    expect(m.probe(part).gain).toBeCloseTo(0, 9);
  });

  it('measures its own gap, not the gap the voice caught up by', () => {
    const input = level<Part>(0);
    const m = mix<Part, Pose>(PART);
    m.cue({
      patch: patch<Part, Pose>(0, () => ({ gain: 0 }), { writes: ['gain'] }),
      weight: slew(input, { riseMs: 1000 }),
    });
    m.sync(0);
    m.probe(part);
    input.set(1);
    const seen: number[] = [];
    for (let t = 100; t <= 500; t += 100) {
      m.sync(t);
      seen.push(1 - m.probe(part).gain);
    }
    for (const [i, w] of seen.entries()) expect(w).toBeCloseTo(0.1 * (i + 1), 9);
  });

  it('marks itself driven by outside input when what it follows is', () => {
    expect(slew(level<Part>(0), { riseMs: 100 }).input).toBe(true);
    expect(gate(peak(level<Part>(0)), 0.5).input).toBe(true);
    expect(slew<Part>(() => 0.5, { riseMs: 100 }).input).toBeUndefined();
  });
});

describe('lag', () => {
  it('closes 1 − exp(−gap / ms) of the distance, rising and falling on their own constants', () => {
    const input = level<Part>(0);
    const followed = lag<Part>(input, { riseMs: 100, fallMs: 200 });
    expect(followed(part, frame(0, 0))).toBe(0);

    input.set(1);
    expect(followed(part, frame(100, 100))).toBeCloseTo(1 - Math.exp(-1), 12);

    input.set(0);
    const from = 1 - Math.exp(-1);
    expect(followed(part, frame(300, 200))).toBeCloseTo(from * Math.exp(-1), 12);

    expect(followed(part, frame(316, Number.POSITIVE_INFINITY))).toBe(0);
  });

  it('lands on its input once within floor of it, and never with floor 0', () => {
    const input = level<Part>(1);
    const landing = lag<Part>(input, { fallMs: 100 });
    const exact = lag<Part>(input, { fallMs: 100, floor: 0 });
    landing(part, frame(0, 0));
    exact(part, frame(0, 0));
    input.set(0);
    expect(landing(part, frame(1400, 1400))).toBe(0);
    expect(exact(part, frame(1400, 1400))).toBeCloseTo(Math.exp(-14), 15);
    expect(exact(part, frame(1400, 1400))).toBeGreaterThan(0);
  });

  it('reads the same at any frame spacing while its input holds still', () => {
    const read = (every: number): number => {
      kept = new Map();
      const input = level<Part>(0);
      const followed = lag<Part>(input, { riseMs: 100, fallMs: 100 });
      followed(part, frame(0, 0));
      input.set(1);
      let v = 0;
      for (let t = every; t <= 240; t += every) v = followed(part, frame(t, every));
      return v;
    };
    const exact = 1 - Math.exp(-240 / 100);
    for (const every of [5, 8, 16, 30, 48, 80, 240]) expect(read(every)).toBeCloseTo(exact, 12);
  });

  it('marks itself driven by outside input when what it follows is', () => {
    expect(lag<Part>(level<Part>(0), { riseMs: 10 }).input).toBe(true);
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
