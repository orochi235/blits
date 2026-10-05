import { describe, expect, it } from 'vitest';
import { hex, kit, max, mixHex, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { tween } from '../src/motion.js';
import { keys, patch } from '../src/patch.js';
import { level } from '../src/signals.js';
import type { Setting } from '../src/types.js';

interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  color: number;
  position: number[];
}
const PART = kit<Pose>({
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

describe('locus fold', () => {
  it('folds only the channels a patch writes, as a fold outside a locus does', () => {
    // The patch declares crawl and returns dark besides, which no fold may take.
    const loose = patch<Part, Pose>(0, () => ({ crawl: 3, dark: 0.7 }), { writes: ['crawl'] });
    for (const locus of [undefined, 'phase']) {
      const m = mix<Part, Pose>(PART, { lanes: false });
      m.cue({ patch: loose, locus });
      m.cue({ patch: holds('crawl', 5), locus });
      m.sync(0);
      expect(m.probe(part).dark, `locus ${locus}`).toBe(0);
    }
  });

  it('two voices in a locus driving the same value produce that value, on every channel', () => {
    for (const [channel, value] of [
      ['gain', 0.06],
      ['crawl', 4],
      ['dark', 0.8],
    ] as const) {
      const m = mix<Part, Pose>(PART);
      m.cue({ patch: holds(channel, value), locus: 'phase' });
      m.cue({ patch: holds(channel, value), locus: 'phase' });
      m.sync(0);
      expect(m.probe(part)[channel]).toBeCloseTo(value, 9);
    }
  });

  it('the same two voices outside a locus pile up, which is what a locus is for', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: holds('gain', 0.06) });
    m.cue({ patch: holds('gain', 0.06) });
    m.sync(0);
    expect(m.probe(part).gain).toBeCloseTo(0.06 * 0.06, 9);
  });

  it('on a sum channel the fold is the number scaling and joining already gives', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('crawl', 10), locus: 'phase' });
    const b = m.cue({ patch: holds('crawl', 20), locus: 'phase' });
    a.weight = 0.25;
    b.weight = 0.75;
    m.sync(0);
    expect(m.probe(part).crawl).toBeCloseTo(0.25 * 10 + 0.75 * 20, 9);
  });

  it('a locus whose weights sum below 1 scales the folded value toward rest', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('gain', 0.5), locus: 'phase' });
    const b = m.cue({ patch: holds('gain', 0.5), locus: 'phase' });
    a.weight = 0.2;
    b.weight = 0.2;
    m.sync(0);
    // lerp(0.5, 0.5, ·) = 0.5, then scaled toward rest 1 by the summed 0.4.
    expect(m.probe(part).gain).toBeCloseTo(1 + (0.5 - 1) * 0.4, 9);
  });

  it('a locus caps at 1, so three voices at full weight are still one alternative', () => {
    const m = mix<Part, Pose>(PART);
    for (let i = 0; i < 3; i++) m.cue({ patch: holds('gain', 0.2), locus: 'phase' });
    m.sync(0);
    expect(m.probe(part).gain).toBeCloseTo(0.2, 9);
  });

  it('a rest-less channel crossfades through its own lerp instead of switching', () => {
    const m = mix<Part, Pose>(PART);
    const a = m.cue({ patch: holds('color', 0x000000), locus: 'phase' });
    const b = m.cue({ patch: holds('color', 0xffffff), locus: 'phase' });
    a.weight = 0.5;
    b.weight = 0.5;
    m.sync(0);
    expect(m.probe(part).color).toBe(mixHex(0x000000, 0xffffff, 0.5));
  });
});

describe('fade', () => {
  it('a voice stopped mid-pass makes no jump larger than its per-frame ramp', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 100), fade: { out: 100 } });
    m.sync(0);
    let previous = m.probe(part).crawl;
    h.fade();
    const seen: number[] = [];
    for (let now = 16; now <= 128; now += 16) {
      m.sync(now);
      const value = m.probe(part).crawl;
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
    expect(m.probe(part).crawl).toBeCloseTo(0, 9);
    m.sync(50);
    expect(m.probe(part).crawl).toBeCloseTo(50, 9);

    const snapped = mix<Part, Pose>(PART, { reduce: true });
    snapped.cue({ patch: holds('crawl', 100), fade: { in: 100 } });
    snapped.sync(0);
    expect(snapped.probe(part).crawl).toBeCloseTo(100, 9);
  });

  it('clear takes `over`, the same word handle.fade takes', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 100) });
    m.sync(0);
    m.probe(part);
    m.mute({ over: 100 });
    m.sync(50);
    expect(m.probe(part).crawl).toBeCloseTo(50, 9);
    m.sync(100);
    m.probe(part);
    expect(m.live).toBe(false);
    await h.done;
    expect(h.state).toBe('done');
  });
});

describe('handover at rest', () => {
  it('removes a voice per subject at its first resting frame', () => {
    const settling = patch<Part, Pose>(
      0,
      (_phase, _p, setting) => ({ crawl: setting.timestamp >= 100 ? 0 : 10 }),
      { writes: ['crawl'] },
    );
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: settling });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(10);
    h.fade({ at: 'rest' });
    m.sync(50);
    expect(m.probe(part).crawl).toBe(10);
    m.sync(100);
    expect(m.probe(part).crawl).toBe(0);
    m.sync(116);
    expect(m.live).toBe(false);
  });

  it('leaves at the deadline for a patch that never rests', async () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: holds('crawl', 10) });
    m.sync(0);
    m.probe(part);
    h.fade({ at: 'rest', deadline: 200 });
    m.sync(100);
    expect(m.probe(part).crawl).toBe(10);
    m.sync(200);
    m.probe(part);
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
    m.probe(part);
    m.sync(400);
    const before = m.probe(part).crawl;
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
    expect(m.probe(part).crawl).toBeCloseTo(before, 9);

    // And it leaves at the speed the subject had, 0.1 a ms, before it turns toward stop 1.
    m.sync(416);
    const next = m.probe(part).crawl;
    expect((next - before) / 16).toBeCloseTo(0.1, 2);
    m.sync(1300);
    expect(m.probe(part).crawl).toBeLessThan(10);
  });

  it("a from: 'current' voice cued on a still subject leaves at rest and eases into its segment", () => {
    const m = mix<Part, Pose>(PART);
    const held = m.cue({
      patch: patch<Part, Pose>(0, () => ({ crawl: 50 }), { writes: ['crawl'] }),
    });
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    held.weight = 0;
    m.cue({ patch: keys<Part, Pose>(1000, [{ at: 1, delta: { crawl: 0 } }]), from: 'current' });
    m.sync(17);
    const a = m.probe(part).crawl;
    m.sync(18);
    // A linear segment from 50 to 0 moves 0.05 a ms; leaving a standstill, it starts near 0 instead.
    expect(a - m.probe(part).crawl).toBeLessThan(0.001);
    m.sync(516);
    // Half way: the linear 25 plus the bend, 50 · ½ · ¼.
    expect(m.probe(part).crawl).toBeCloseTo(31.25, 6);
  });
});

describe('blend between alternatives', () => {
  it('cues the patches into one locus and crossfades them by the signal', () => {
    const k = level<Part>(0);
    const m = mix<Part, Pose>(PART);
    m.blend([holds('crawl', 0), holds('crawl', 10), holds('crawl', 20)], k);
    m.sync(0);
    expect(m.probe(part).crawl).toBeCloseTo(0, 9);
    k.set(0.5);
    m.sync(16);
    expect(m.probe(part).crawl).toBeCloseTo(10, 9);
    k.set(0.75);
    m.sync(32);
    expect(m.probe(part).crawl).toBeCloseTo(15, 9);
    k.set(1);
    m.sync(48);
    expect(m.probe(part).crawl).toBeCloseTo(20, 9);
  });

  for (const lanes of [true, false])
    describe(`with lanes ${lanes ? 'on' : 'off'}`, () => {
      const parts = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }));

      it('reads its signal once per subject read, for every member', () => {
        let calls = 0;
        const by = (p: Part) => {
          calls++;
          return Number(p.id.slice(1)) / 4;
        };
        const m = mix<Part, Pose>(PART, { lanes });
        m.blend([holds('crawl', 0), holds('crawl', 10), holds('crawl', 20)], by);
        for (let f = 0; f < 4; f++) {
          m.sync(f * 16);
          calls = 0;
          for (const p of parts) expect(m.probe(p).crawl).toBeCloseTo(Number(p.id.slice(1)) * 5, 9);
          expect(calls).toBe(parts.length);
          // Once lanes fill, a second read in the frame reads what they hold.
          for (const p of parts) m.probe(p);
          expect(calls).toBe(lanes && f > 0 ? parts.length : 2 * parts.length);
        }
      });

      it('steps a signal that keeps state once per subject per frame, through member changes', () => {
        let steps = 0;
        const by = (_p: Part, setting: Setting) => {
          const held = setting.keep(by, () => ({ n: 0 }));
          held.n++;
          steps++;
          return Math.min(1, held.n / 10);
        };
        const m = mix<Part, Pose>(PART, { lanes, history: { ms: 1000 } });
        const [first, second] = m.blend([holds('crawl', 0), holds('crawl', 10)], by);
        for (let f = 1; f <= 6; f++) {
          m.sync(f * 16);
          steps = 0;
          for (const p of parts) m.probe(p);
          expect(steps).toBe(parts.length);
          expect(second?.weightOf(parts[0] as Part)).toBeCloseTo(f / 10, 9);
        }
        // A read elsewhere in time steps a copy, not the live state.
        m.project(200).probe(parts[0] as Part);
        m.project(40).probe(parts[0] as Part);
        // The member that read first leaves; the other carries on from the same state.
        first?.fade({ over: 0 });
        for (let f = 7; f <= 9; f++) {
          m.sync(f * 16);
          steps = 0;
          for (const p of parts) m.probe(p);
          expect(steps).toBe(parts.length);
          expect(second?.weightOf(parts[0] as Part)).toBeCloseTo(f / 10, 9);
        }
      });

      it('reads back what an input signal read, under history with inputs', () => {
        const k = level<Part>(0);
        const m = mix<Part, Pose>(PART, { lanes, history: { ms: 1000, inputs: true } });
        m.blend([holds('crawl', 0), holds('crawl', 10), holds('crawl', 20)], k);
        const seen: number[] = [];
        for (let f = 0; f < 5; f++) {
          k.set(f / 4);
          m.sync(f * 16);
          seen.push(m.probe(part).crawl);
        }
        for (let f = 0; f < 5; f++) expect(m.project(f * 16).probe(part).crawl).toBe(seen[f]);
      });
    });
});

describe('the pose', () => {
  it('starts at rest per channel and leaves a rest-less channel alone when nothing passes', () => {
    const m = mix<Part, Pose>(PART);
    m.sync(0);
    const pose = m.probe(part);
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
    expect(m.probe(part, out)).toBe(out);
    expect(out.crawl).toBe(7);
  });
});

describe('fading one subject out of a voice', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const crawls = (n: number) => patch<Part, Pose>(0, () => ({ crawl: n }), { writes: ['crawl'] });

  it('ramps that subject alone, then the voice reaches it no more and plays on for the rest', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: crawls(10) });
    m.sync(0);
    m.probe(a);
    m.probe(b);
    h.fade({ subject: a, over: 100 });
    m.sync(50);
    expect(m.probe(a).crawl).toBeCloseTo(5, 9);
    expect(m.probe(b).crawl).toBe(10);
    m.sync(100);
    expect(m.probe(a).crawl).toBe(0);
    m.sync(500);
    expect(m.probe(a).crawl).toBe(0);
    expect(h.weightOf(a)).toBe(0);
    expect(m.probe(b).crawl).toBe(10);
    expect(h.state).toBe('live');
  });

  it('takes the subject out at once over 0, and under reduced motion', () => {
    for (const reduce of [false, true]) {
      const m = mix<Part, Pose>(PART, { reduce });
      const h = m.cue({ patch: crawls(10), fade: { out: 300 } });
      m.sync(0);
      m.probe(a);
      h.fade(reduce ? { subject: a } : { subject: a, over: 0 });
      expect(m.probe(a).crawl).toBe(0);
      expect(m.probe(b).crawl).toBe(10);
    }
  });

  it('leaves nothing stacked under the voice that takes the subject over', () => {
    const m = mix<Part, Pose>(PART);
    const first = m.cue({ patch: crawls(5) });
    m.sync(0);
    m.probe(a);
    first.fade({ subject: a, over: 0 });
    m.cue({ patch: crawls(3) });
    m.sync(16);
    expect(m.probe(a).crawl).toBe(3);
    expect(m.probe(b).crawl).toBe(8);
  });

  it('is forgotten by drop on a voice that does not name the subject, which goes inert', () => {
    const m = mix<Part, Pose>(PART);
    const a = { id: 'x' };
    const b = { id: 'y' };
    const h = m.cue({
      patch: tween<Part, Pose>('crawl', { from: 0, to: 1, ms: 10 }),
      subjects: [b],
    });
    m.sync(0);
    m.probe(b);
    h.fade({ subject: a, over: 100 });
    m.sync(16);
    m.probe(b);
    expect(m.inert).toBe(false);
    m.drop(a);
    m.sync(32);
    m.probe(b);
    expect(m.inert).toBe(true);
  });

  it('is forgotten with the subject by drop, so the voice reaches it again', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: crawls(5) });
    m.sync(0);
    h.fade({ subject: a, over: 0 });
    expect(m.probe(a).crawl).toBe(0);
    m.drop(a);
    m.sync(16);
    expect(m.probe(a).crawl).toBe(5);
  });

  it('reads mid-ramp and past it from a projection, leaving the live mix as it was', () => {
    const m = mix<Part, Pose>(PART);
    const h = m.cue({ patch: crawls(10) });
    m.sync(0);
    m.probe(a);
    h.fade({ subject: a, over: 100 });
    expect(m.project(25).probe(a).crawl).toBeCloseTo(7.5, 9);
    expect(m.project(200).probe(a).crawl).toBe(0);
    m.sync(50);
    expect(m.probe(a).crawl).toBeCloseTo(5, 9);
  });
});
