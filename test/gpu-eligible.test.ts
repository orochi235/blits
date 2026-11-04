import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { eligibility, within } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Timings } from '../src/gpu/timings.js';
import { kit, mix, quat, tween } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Voice } from '../src/voice.js';
import { type C, cells, elig, K, type P, wave } from './gpu-fixtures.js';

describe('gpu eligibility', () => {
  it('keeps a channel on the CPU, with a reason, when a voice reads a weight signal', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: () => 0.5 });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(false);
    expect(e.reasons[0]?.why).toMatch(/weight signal/);
  });

  it('folds a voice that misses a registered subject on the GPU', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: [cells[0] as C] });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it('never asks Answers about a voice with no stagger, target or named subjects', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, loop: true });
    m.sync(0);
    const mixer = mixerOf(m);
    const answers = new Answers<C>(mixer as unknown as Mixer<C, unknown>);
    answers.register(cells);
    let asked = 0;
    const of = answers.of.bind(answers);
    answers.of = (v) => {
      asked++;
      return of(v);
    };
    const e = eligibility(mixer, answers);
    expect(e.voices.length).toBe(1);
    const voices = e.voices as unknown as Voice<C, unknown>[];
    const slots = new Timings().place(mixer as unknown as Mixer<C, unknown>, voices, answers, 0);
    expect(slots).toEqual([undefined]);
    expect(asked).toBe(0);
  });

  it('keeps a voice on the CPU whose stagger answers NaN for a subject', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, stagger: (c: C) => (c.x === 1 ? Number.NaN : 0) });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(false);
    expect(e.reasons.map((r) => r.why)).toEqual([
      'its stagger gives a subject a delay that is not a finite number',
    ]);
  });

  it('folds a staggered voice on the GPU', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, stagger: (c: C) => c.x * 100, loop: 2 });
    m.cue({ patch: wave, stagger: (c: C) => c.x * 100, loop: true });
    m.sync(0);
    const e = elig(m);
    expect(e.reasons).toEqual([]);
    expect(e.voices.length).toBe(2);
  });

  it('folds a staggered motion voice on the GPU, named or asked as met', () => {
    const m = mix<C, P>(K);
    const motion = () => tween<C, P>('y', { from: 0, to: 1, ms: 500 });
    m.cue({ patch: motion(), subjects: cells, stagger: (c: C) => c.x * 100 });
    m.cue({ patch: motion(), stagger: (c: C) => c.x * 100 });
    m.sync(0);
    const e = elig(m);
    expect(e.reasons).toEqual([]);
    expect(e.voices.length).toBe(2);
  });

  it("keeps a staggered motion voice on the CPU for a staggered voice's reasons", () => {
    const m = mix<C, P>(K);
    const motion = () => tween<C, P>('y', { from: 0, to: 1, ms: 500 });
    const h = m.cue({
      patch: motion(),
      subjects: cells,
      stagger: () => 10,
      fade: { in: 400, out: 300 },
    });
    m.cue({ patch: motion(), stagger: (c: C) => c.x * 100 - 50 });
    m.cue({
      patch: motion(),
      subjects: cells,
      stagger: () => 10,
      fade: { in: 400, ease: (u) => u },
    });
    m.sync(0);
    m.sync(100);
    h.fade();
    m.sync(200);
    h.rise();
    m.sync(250);
    expect(elig(m).reasons.map((r) => r.why)).toEqual([
      'its fade in stalled where a fade out turned back, and its subjects start at different times',
      'its stagger is asked as subjects are met and gives some a negative delay, so where it ends running back depends on which were read',
      'its fade in eases by a function, which the GPU cannot run',
    ]);
  });

  it('keeps an unnamed staggered voice with an end on the CPU', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, stagger: (c: C) => c.x * 100, loop: 2 });
    m.cue({ patch: wave, target: () => true, stagger: (c: C) => c.x * 100 });
    m.sync(0);
    const why =
      'its stagger is asked as subjects are met, so when it ends depends on which were read';
    expect(elig(m).reasons.map((r) => r.why)).toEqual([why, why]);
  });

  it('keeps an unnamed staggered voice with an end on the CPU without asking a subject', () => {
    const m = mix<C, P>(K);
    let calls = 0;
    const counted = (c: C) => {
      calls++;
      return c.x * 100;
    };
    m.cue({ patch: wave, stagger: counted, loop: 2 });
    m.cue({ patch: wave, target: counted, stagger: counted });
    m.sync(0);
    const mixer = mixerOf(m);
    const answers = new Answers<C>(mixer as unknown as Mixer<C, unknown>);
    answers.register(Array.from({ length: 1000 }, (_, x) => ({ x })));
    let asked = 0;
    const of = answers.of.bind(answers);
    answers.of = (v) => {
      asked++;
      return of(v);
    };
    expect(eligibility(mixer, answers).reasons.length).toBe(2);
    expect([calls, asked]).toEqual([0, 0]);
  });

  it('keeps an unnamed staggered loop with a negative delay on the CPU, cued forward', () => {
    const m = mix<C, P>(K);
    const h = m.cue({ patch: wave, stagger: (c: C) => c.x * 100 - 50, loop: true });
    m.cue({ patch: wave, stagger: (c: C) => c.x * 100 - 50, loop: true, rate: -1 });
    m.sync(0);
    const why =
      'its stagger is asked as subjects are met and gives some a negative delay, so where it ends running back depends on which were read';
    expect(elig(m).reasons.map((r) => r.why)).toEqual([why]);
    m.sync(100);
    h.rate = -1;
    m.sync(150);
    expect(elig(m).reasons.map((r) => r.why)).toEqual([why]);
  });

  it('keeps a staggered voice fading in on a function on the CPU', () => {
    const m = mix<C, P>(K);
    const stagger = (c: C) => c.x * 100;
    m.cue({ patch: wave, subjects: cells, stagger, fade: { in: 400, ease: (u) => u * u } });
    m.cue({ patch: wave, subjects: cells, stagger, fade: { in: 400, ease: 'ease-in-out' } });
    m.cue({ patch: wave, subjects: cells, fade: { in: 400, ease: (u) => u * u } });
    m.sync(0);
    expect(elig(m).reasons.map((r) => r.why)).toEqual([
      'its fade in eases by a function, which the GPU cannot run',
    ]);
  });

  it('keeps a staggered voice on the CPU once its fade out is turned back', () => {
    const m = mix<C, P>(K);
    const h = m.cue({
      patch: wave,
      subjects: cells,
      stagger: (c: C) => c.x * 100,
      loop: true,
      fade: { in: 400, out: 300 },
    });
    m.sync(0);
    m.sync(100);
    h.fade();
    m.sync(200);
    expect(elig(m).reasons).toEqual([]);
    h.rise();
    m.sync(250);
    expect(elig(m).reasons.map((r) => r.why)).toEqual([
      'its fade in stalled where a fade out turned back, and its subjects start at different times',
    ]);
  });

  it('keeps a channel whose rule has no WGSL on the CPU', () => {
    const m = mix<C, { r: number[] }>(kit({ r: quat() }));
    m.sync(0);
    expect(elig(m).channels.size).toBe(0);
  });

  it('keeps a voice on the CPU, with a reason, where its buffer would pass the device limit', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, loop: true });
    m.sync(0);
    const e = elig(m);
    within(e, () => ({ values: 4, persub: 0 }), 16);
    expect(e.voices.length).toBe(1);
    within(e, () => ({ values: 4, persub: 8 }), 16);
    expect(e.voices).toEqual([]);
    expect(e.channels.has('y')).toBe(false);
    expect(e.reasons[0]?.why).toMatch(/per-subject buffer past the largest the device binds/);
  });

  it('folds a channel no playing voice writes on the GPU, at its rest', () => {
    const m = mix<C, P>(K);
    m.sync(0);
    expect(elig(m).channels.has('y')).toBe(true);
  });
});
