import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { eligibility, within } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Regions } from '../src/gpu/region.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { Col, ROW, type Slot, voiceTable } from '../src/gpu/table.js';
import { Timings } from '../src/gpu/timings.js';
import { Flag, NONE } from '../src/gpu/wgsl/timing.js';
import { kit, type Mix, mix, quat, sum } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Voice } from '../src/voice.js';

interface C {
  x: number;
}
interface P {
  y: number;
}
const K = kit<P>({ y: sum() });
const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;',
  at: (phase) => ({ y: phase }),
  writes: ['y'],
});
const slots = Array.from({ length: 3 }, () => ({ runner: 0, values: 0, sub: 0 }));
const cells = [{ x: 0 }, { x: 1 }];

/** `eligibility` for `m`'s voices over `list`, with an `Answers` registered as the gpu side's is. */
function elig<O>(m: Mix<C, O>, list: readonly C[] = cells) {
  const mixer = mixerOf(m);
  const answers = new Answers<C>(mixer as unknown as Mixer<C, unknown>);
  answers.register(list);
  return eligibility(mixer, answers);
}

/** A staggered voice's table, at each sync, with its timing block laid as the gpu side lays it. */
function staggered(spec: Record<string, unknown>, list: readonly C[] = cells) {
  const m = mix<C, P>(K);
  m.sync(0);
  const handle = m.cue({ patch: wave, subjects: list, stagger: (c: C) => c.x * 100, ...spec });
  const mixer = mixerOf(m);
  const voices = [...mixer.cued];
  const answers = new Answers<C>(mixer as unknown as Mixer<C, unknown>);
  answers.register(list);
  const timings = new Timings();
  return (now: number, ease?: number) => {
    m.sync(now);
    const timing = timings.place(
      mixer as unknown as Mixer<C, unknown>,
      voices as unknown as Voice<C, unknown>[],
      answers,
      0,
    );
    const t = voiceTable(mixer, voices, [
      { runner: 0, values: 0, sub: 0, timing: timing[0], ease },
    ]);
    return {
      rows: t.rows,
      bits: new Uint32Array(t.rows.buffer),
      voice: voices[0] as Voice<C, P>,
      handle,
    };
  };
}

describe('voice table', () => {
  it('gives the phase and weight the CPU folds with', () => {
    const m = mix<C, P>(K, { history: { ms: 5000, tape: createHistory } });
    const h = m.cue({ patch: wave, subjects: cells, loop: true, fade: { in: 400 } });
    m.sync(0);
    m.sync(250);
    const e = elig(m);
    const t = voiceTable(mixerOf(m), e.voices, slots);
    m.probe(cells[0] as C);
    expect(t.count).toBe(1);
    expect(t.rows[Col.PHASE]).toBeCloseTo(0.25, 6);
    expect(t.rows[Col.WEIGHT]).toBeCloseTo(h.weightOf(cells[0] as C), 6);
    expect(t.rows[Col.WEIGHT]).toBeGreaterThan(0);
    expect(t.rows[Col.WEIGHT]).toBeLessThan(1);
  });

  it('gives every member its role, and marks only those showing', () => {
    const m = mix<C, P>(K);
    // Before its start, so it shows nothing, and it keeps its role.
    m.cue({ patch: wave, subjects: cells, role: 'a', loop: true, seek: -500 });
    m.cue({ patch: wave, subjects: cells, role: 'a' });
    m.cue({ patch: wave, subjects: cells, role: 'a' });
    m.cue({ patch: wave, subjects: cells });
    m.sync(0);
    const voices = elig(m).voices;
    expect(voices.length).toBe(4);
    const four = Array.from({ length: 4 }, () => ({ runner: 0, values: 0, sub: 0 }));
    const t = voiceTable(mixerOf(m), voices, four);
    const col = (c: Col) => [0, 1, 2, 3].map((k) => t.rows[k * ROW + c]);
    expect(col(Col.ROLE)).toEqual([1, 1, 1, 0]);
    const flags = new Uint32Array(t.rows.buffer);
    expect([0, 1, 2, 3].map((k) => (flags[k * ROW + Col.FLAGS] as number) & Flag.SHOWS)).toEqual([
      0,
      Flag.SHOWS,
      Flag.SHOWS,
      Flag.SHOWS,
    ]);
  });

  it("carries a staggered voice's clock relative to its pass", () => {
    const loop = staggered({ loop: true })(2250);
    expect(loop.rows[Col.CLOCK]).toBe(250);
    expect(loop.rows[Col.START]).toBe(-2000);
    expect(loop.rows[Col.PASS_BASE]).toBe(2);
    expect(loop.rows[Col.DURATION]).toBe(1000);
    expect((loop.bits[Col.FLAGS] as number) & Flag.FINITE).toBe(0);
    expect((loop.bits[Col.FLAGS] as number) & Flag.SHOWS).toBe(0);

    const three = staggered({ loop: 3, freeze: 'after' })(5000);
    expect(three.rows[Col.CLOCK]).toBe(3000);
    expect(three.rows[Col.START]).toBe(-2000);
    expect(three.rows[Col.PASS_BASE]).toBe(2);
    expect(three.rows[Col.LAST_PASS]).toBe(2);
    expect(three.rows[Col.SPAN]).toBe(1000);
    const flags = three.bits[Col.FLAGS] as number;
    expect(flags & Flag.FINITE).toBe(Flag.FINITE);
    expect(flags & Flag.FREEZES_AFTER).toBe(Flag.FREEZES_AFTER);
    expect(flags & Flag.HIDES_PAST).toBe(0);
  });

  it('marks a staggered voice yet to start, at pass 0', () => {
    const at = staggered({ loop: true, start: 1000 });
    const t = at(500);
    expect(t.voice.state).toBe('pending');
    const flags = t.bits[Col.FLAGS] as number;
    expect(flags & Flag.UNSTARTED).toBe(Flag.UNSTARTED);
    expect(t.rows[Col.CLOCK]).toBe(0);
    expect(t.rows[Col.PASS_BASE]).toBe(0);
  });

  it('marks a voice whose clock reads NaN, and sends no NaN', () => {
    const at = staggered({ loop: true });
    const { voice } = at(500);
    // `frozenTime`'s pending voice at rate 0 reads its clock as infinity times 0.
    voice.rawAt = () => Number.NaN;
    const t = at(600);
    expect((t.bits[Col.FLAGS] as number) & Flag.NO_CLOCK).toBe(Flag.NO_CLOCK);
    expect(t.rows[Col.CLOCK]).toBe(0);
    expect(t.rows[Col.START]).toBe(-0);
    expect(t.rows[Col.PASS_BASE]).toBe(0);
  });

  it('keeps a beginless voice its pass and a clock inside it, hours back', () => {
    const at = staggered({ loop: true, rate: -1 });
    const hours = 3 * 3600 * 1000 + 250;
    const t = at(hours);
    expect(t.voice.beginless).toBe(true);
    const raw = t.voice.rawAt(hours, 0);
    expect(raw).toBe(-hours);
    expect(t.rows[Col.CLOCK]).toBe(750);
    expect(t.rows[Col.PASS_BASE]).toBe(Math.floor(raw / 1000));
    expect(t.rows[Col.START]).toBe(-1000 * Math.floor(raw / 1000));
    expect((t.bits[Col.FLAGS] as number) & Flag.BEGINLESS).toBe(Flag.BEGINLESS);
  });

  it('sets FADE only while some subject is still fading in', () => {
    const four = [0, 1, 2, 3].map((x) => ({ x }));
    // Origins at 0, 100, 200 and 300: the last subject's fade in ends at 700.
    const at = staggered({ loop: true, weight: 0.5, fade: { in: 400 } }, four);
    // The block is made, and anchored, at 100.
    expect((at(100).bits[Col.FLAGS] as number) & Flag.FADE).toBe(Flag.FADE);
    const fading = at(500);
    expect((fading.bits[Col.FLAGS] as number) & Flag.FADE).toBe(Flag.FADE);
    expect(fading.rows[Col.FADE_IN]).toBe(400);
    expect(fading.rows[Col.FADE_END]).toBe(400);
    expect(fading.rows[Col.WEIGHT]).toBe(0.5);
    const done = at(800);
    expect((done.bits[Col.FLAGS] as number) & Flag.FADE).toBe(0);
    expect(done.rows[Col.WEIGHT]).toBe(0.5);

    const none = staggered({ loop: true }, four)(100);
    expect((none.bits[Col.FLAGS] as number) & Flag.FADE).toBe(0);
    expect(none.rows[Col.WEIGHT]).toBe(1);
  });

  it('takes the fade in as done, and the fade out as it stands, once FADE is off', () => {
    const four = [0, 1, 2, 3].map((x) => ({ x }));
    // Every delay negative, from 1000 ms before its start: origins 200 to 500, and delay 0's at
    // 1000, whose own fade in has yet to begin at 950.
    const at = staggered(
      {
        loop: true,
        seek: -1000,
        stagger: (c: C) => -500 - c.x * 100,
        fade: { in: 400, out: 1000 },
      },
      four,
    );
    expect((at(800).bits[Col.FLAGS] as number) & Flag.FADE).toBe(Flag.FADE);
    const done = at(950);
    expect((done.bits[Col.FLAGS] as number) & Flag.FADE).toBe(0);
    expect(done.rows[Col.WEIGHT]).toBe(1);
    done.handle.fade();
    expect(at(1200).rows[Col.WEIGHT]).toBeCloseTo(0.75, 6);
  });

  it('reads offsets back as the u32s written', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, loop: true, stagger: (c: C) => c.x * 100 });
    m.sync(0);
    const far = 2 ** 24 + 1;
    const slot: Slot = {
      runner: 0,
      values: 0,
      sub: 0,
      timing: { delays: far, mask: far + 2, shown: far + 4, anchor: 0, latest: 0 },
      ease: far + 6,
    };
    const t = voiceTable(mixerOf(m), [...mixerOf(m).cued], [slot]);
    const bits = new Uint32Array(t.rows.buffer);
    expect([Col.DELAYS, Col.MASK, Col.SHOWN, Col.EASE].map((c) => bits[c])).toEqual([
      far,
      far + 2,
      far + 4,
      far + 6,
    ]);
    const plain = voiceTable(mixerOf(m), [...mixerOf(m).cued], [{ runner: 0, values: 0, sub: 0 }]);
    const none = new Uint32Array(plain.rows.buffer);
    expect([Col.DELAYS, Col.MASK, Col.SHOWN, Col.EASE].map((c) => none[c])).toEqual([
      NONE,
      NONE,
      NONE,
      NONE,
    ]);
  });

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

  it('keeps a channel whose rule has no WGSL on the CPU', () => {
    const m = mix<C, { r: number[] }>(kit({ r: quat() }));
    m.sync(0);
    expect(elig(m).channels.size).toBe(0);
  });

  it('writes the values and per-subject offsets as u32 bits, exact past 2^24', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, loop: true });
    m.sync(0);
    const e = elig(m);
    const far = 2 ** 24 + 1;
    const t = voiceTable(mixerOf(m), e.voices, [{ runner: 0, values: far, sub: far + 2 }]);
    const bits = new Uint32Array(t.rows.buffer);
    expect(bits[Col.VALUES]).toBe(far);
    expect(bits[Col.SUB]).toBe(far + 2);
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

describe('regions', () => {
  const a = {};
  const b = {};
  const one = Float32Array.of(1, 2);
  const two = Float32Array.of(3, 4, 5);

  it('reports nothing changed the second frame with the same voices', () => {
    const r = new Regions();
    const first = r.frame([
      { owner: a, values: one },
      { owner: b, values: two },
    ]);
    expect(first.changed).toEqual([[0, 20]]);
    const second = r.frame([
      { owner: a, values: one },
      { owner: b, values: two },
    ]);
    expect(second.offsets).toEqual(first.offsets);
    expect(second.changed).toEqual([]);
  });

  it("reports only a voice's range when its patch is replaced", () => {
    const r = new Regions();
    r.frame([
      { owner: a, values: one },
      { owner: b, values: two },
    ]);
    const next = r.frame([
      { owner: a, values: one },
      { owner: b, values: Float32Array.of(6, 7, 8) },
    ]);
    expect(next.offsets).toEqual([0, 2]);
    expect(next.changed).toEqual([[8, 20]]);
    expect([...r.data.subarray(0, 5)]).toEqual([1, 2, 6, 7, 8]);
  });

  it('lays every voice out afresh where the holes would pass the cap', () => {
    const r = new Regions();
    r.frame([
      { owner: a, values: one },
      { owner: b, values: two },
    ]);
    const next = r.frame(
      [
        { owner: a, values: one },
        { owner: b, values: Float32Array.of(6, 7, 8, 9) },
      ],
      6,
    );
    expect(r.length).toBe(6);
    expect(next.offsets).toEqual([0, 2]);
    expect(next.changed).toEqual([[0, 24]]);
  });
});
