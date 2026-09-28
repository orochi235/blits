import { describe, expect, it } from 'vitest';
import { hex, max, mul, rig, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { level } from '../src/signals.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  color: number;
  position: number[];
}
const PART = rig<Pose>({
  gain: mul(),
  crawl: sum(),
  dark: max(),
  color: hex(),
  position: vec(3, sum()),
});

interface Part {
  id: string;
}
const part = { id: 'a' };

const holds = <K extends keyof Pose>(channel: K, value: Pose[K]) =>
  patch<Part, Pose>(0, () => ({ [channel]: value }) as Partial<Pose>, { writes: [channel] });

describe('group fold', () => {
  it('two voices in a group driving the same value produce that value, on every channel', () => {
    for (const [channel, value] of [
      ['gain', 0.06],
      ['crawl', 4],
      ['dark', 0.8],
    ] as const) {
      const m = mix<Part, Pose>(PART);
      m.cue({ patch: holds(channel, value), group: 'phase' });
      m.cue({ patch: holds(channel, value), group: 'phase' });
      m.sync(0);
      expect(m.sample(part)[channel]).toBeCloseTo(value, 9);
    }
  });

  it('the same two voices outside a group pile up, which is what a group is for', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: holds('gain', 0.06) });
    m.cue({ patch: holds('gain', 0.06) });
    m.sync(0);
    expect(m.sample(part).gain).toBeCloseTo(0.06 * 0.06, 9);
  });

  it('on a sum channel the fold is the number scaling and joining already gives', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('crawl', 10), group: 'phase' });
    const b = m.cue({ patch: holds('crawl', 20), group: 'phase' });
    a.weight = 0.25;
    b.weight = 0.75;
    m.sync(0);
    expect(m.sample(part).crawl).toBeCloseTo(0.25 * 10 + 0.75 * 20, 9);
  });

  it('a group whose weights sum below 1 scales the folded value toward rest', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('gain', 0.5), group: 'phase' });
    const b = m.cue({ patch: holds('gain', 0.5), group: 'phase' });
    a.weight = 0.2;
    b.weight = 0.2;
    m.sync(0);
    // lerp(0.5, 0.5, ·) = 0.5, then scaled toward rest 1 by the summed 0.4.
    expect(m.sample(part).gain).toBeCloseTo(1 + (0.5 - 1) * 0.4, 9);
  });

  it('a group caps at 1, so three voices at full weight are still one alternative', () => {
    const m = mix<Part, Pose>(PART);
    for (let i = 0; i < 3; i++) m.cue({ patch: holds('gain', 0.2), group: 'phase' });
    m.sync(0);
    expect(m.sample(part).gain).toBeCloseTo(0.2, 9);
  });

  it('a rest-less channel crossfades through its own lerp instead of switching', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('color', 0x000000), group: 'phase' });
    const b = m.cue({ patch: holds('color', 0xffffff), group: 'phase' });
    a.weight = 0.5;
    b.weight = 0.5;
    m.sync(0);
    expect(m.sample(part).color).toBe(0x808080);
  });
});

describe('fade', () => {
  it('a voice stopped mid-pass makes no jump larger than its per-frame ramp', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 100), fade: { out: 100 } });
    m.sync(0);
    let previous = m.sample(part).crawl;
    h.fade();
    const seen: number[] = [];
    for (let now = 16; now <= 128; now += 16) {
      m.sync(now);
      const value = m.sample(part).crawl;
      seen.push(Math.abs(value - previous));
      previous = value;
    }
    // 100 units over 100 ms, sampled every 16: no step bigger than one frame's worth.
    expect(Math.max(...seen)).toBeLessThanOrEqual(100 * (16 / 100) + 1e-9);
    expect(previous).toBe(0);
  });

  it('fade in ramps from rest, and reduced motion snaps it', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: holds('crawl', 100), fade: { in: 100 } });
    m.sync(0);
    expect(m.sample(part).crawl).toBeCloseTo(0, 9);
    m.sync(50);
    expect(m.sample(part).crawl).toBeCloseTo(50, 9);

    const snapped = mix<Part, Pose>(PART, { reduce: true });
    snapped.cue({ patch: holds('crawl', 100), fade: { in: 100 } });
    snapped.sync(0);
    expect(snapped.sample(part).crawl).toBeCloseTo(100, 9);
  });

  it('clear takes `over`, the same word handle.fade takes', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 100) });
    m.sync(0);
    m.sample(part);
    m.clear({ over: 100 });
    m.sync(50);
    expect(m.sample(part).crawl).toBeCloseTo(50, 9);
    m.sync(100);
    m.sample(part);
    expect(m.live).toBe(false);
    await h.done;
    expect(h.state).toBe('done');
  });
});

describe('handover at rest', () => {
  it('removes a voice per subject at its first resting frame', () => {
    const settling = patch<Part, Pose>(
      0,
      (_phase, _p, setting) => ({ crawl: setting.now >= 100 ? 0 : 10 }),
      { writes: ['crawl'] },
    );
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: settling });
    m.sync(0);
    expect(m.sample(part).crawl).toBe(10);
    h.fade({ at: 'rest' });
    m.sync(50);
    expect(m.sample(part).crawl).toBe(10);
    m.sync(100);
    expect(m.sample(part).crawl).toBe(0);
    m.sync(116);
    expect(m.live).toBe(false);
  });

  it('leaves at the deadline for a patch that never rests', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 10) });
    m.sync(0);
    m.sample(part);
    h.fade({ at: 'rest', deadline: 200 });
    m.sync(100);
    expect(m.sample(part).crawl).toBe(10);
    m.sync(200);
    m.sample(part);
    expect(m.live).toBe(false);
    await h.done;
  });
});

describe('retarget on interruption', () => {
  it("a from: 'current' voice's first sample equals the subject's previous sample", () => {
    const m = mix<Part, Pose>(PART);
    const moving = m.cue({
      patch: patch<Part, Pose>(1000, (phase) => ({ crawl: phase * 100 }), { writes: ['crawl'] }),
    });
    m.sync(0);
    m.sample(part);
    m.sync(400);
    const before = m.sample(part).crawl;
    expect(before).toBeCloseTo(40, 9);

    moving.weight = 0;
    m.cue({
      patch: keys<Part, Pose>(1000, [
        { at: 0, delta: { crawl: 0 } },
        { at: 1, delta: { crawl: 0 } },
      ]),
      from: 'current',
    });
    // Its first frame reproduces where the subject already was, rather than snapping to stop 0.
    expect(m.sample(part).crawl).toBeCloseTo(before, 9);

    m.sync(416);
    const next = m.sample(part).crawl;
    expect(Math.abs(next - before)).toBeLessThanOrEqual((before * 16) / 1000 + 1e-9);
    expect(next).toBeLessThan(before);
  });
});

describe('blend between alternatives', () => {
  it('cues the patches into one group and crossfades them by the signal', () => {
    const k = level<Part>(0);
    const m = mix<Part, Pose>(PART);
    m.blend([holds('crawl', 0), holds('crawl', 10), holds('crawl', 20)], k);
    m.sync(0);
    expect(m.sample(part).crawl).toBeCloseTo(0, 9);
    k.set(0.5);
    m.sync(16);
    expect(m.sample(part).crawl).toBeCloseTo(10, 9);
    k.set(0.75);
    m.sync(32);
    expect(m.sample(part).crawl).toBeCloseTo(15, 9);
    k.set(1);
    m.sync(48);
    expect(m.sample(part).crawl).toBeCloseTo(20, 9);
  });
});

describe('the pose', () => {
  it('starts at rest per channel and leaves a rest-less channel alone when nothing passes', () => {
    const m = mix<Part, Pose>(PART);
    m.sync(0);
    const pose = m.sample(part);
    expect(pose.gain).toBe(1);
    expect(pose.crawl).toBe(0);
    expect(pose.dark).toBe(0);
    expect(pose.position).toEqual([0, 0, 0]);
    expect(pose.color).toBeUndefined();
    expect(m.atRest(part)).toBe(true);
  });

  it('writes into `out` when one is given', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: holds('crawl', 7) });
    m.sync(0);
    const out = {} as Pose;
    expect(m.sample(part, out)).toBe(out);
    expect(out.crawl).toBe(7);
  });
});
