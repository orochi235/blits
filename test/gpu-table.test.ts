import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Regions } from '../src/gpu/region.js';
import { Col, ROW, type Slot, voiceTable } from '../src/gpu/table.js';
import { Timings } from '../src/gpu/timings.js';
import { Flag, NONE } from '../src/gpu/wgsl/timing.js';
import { level, mix } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Voice } from '../src/voice.js';
import { type C, cells, elig, K, type P, wave } from './gpu-fixtures.js';

const slots = Array.from({ length: 3 }, () => ({ runner: 0, values: 0, sub: 0 }));

/** A staggered voice's table, at each sync, with its timing block laid as the gpu side lays it. */
function staggered(
  spec: Record<string, unknown>,
  list: readonly C[] = cells,
  extra: Partial<Slot> = {},
) {
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
      { runner: 0, values: 0, sub: 0, timing: timing[0], ease, ...extra },
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

  it('weighs an owned voice by its owners, as the CPU does', () => {
    const m = mix<C, P>(K, { lanes: false });
    m.sync(0);
    const owner = m.owns({ start: 200, weight: 0.5, fade: { in: 300 } });
    m.cue({ patch: wave, subjects: cells, owner, weight: 0.8, start: 100 });
    const mixer = mixerOf(m);
    const voices = mixer.cued.filter((v) => v.holding === null);
    const child = voices[0] as Voice<C, P>;
    for (const t of [250, 400, 700]) {
      m.sync(t);
      const table = voiceTable(mixer, voices, [{ runner: 0, values: 0, sub: 0 }]);
      m.probe(cells[0] as C);
      const held = child.subjects.get(cells[0] as C);
      // At 250 the child, starting 100 into its owner, has yet to start on either side.
      if (t === 250) {
        expect(held).toBeUndefined();
        expect((new Uint32Array(table.rows.buffer)[Col.FLAGS] as number) & Flag.SHOWS).toBe(0);
        continue;
      }
      const cpu = (held as { weight: number }).weight;
      expect(cpu).toBeGreaterThan(0);
      expect(table.rows[Col.WEIGHT]).toBe(Math.fround(cpu));
    }
  });

  it('weighs a voice by a level read once', () => {
    const m = mix<C, P>(K);
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, weight: level(0.4), fade: { in: 400 } });
    m.sync(100);
    const mixer = mixerOf(m);
    const voice = mixer.cued[0] as Voice<C, P>;
    const t = voiceTable(mixer, [voice], [{ runner: 0, values: 0, sub: 0 }]);
    const fade = mixer.envelope(voice, 100, mixer.shownOf(voice, mixer.sinceOf(voice, 0)));
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(1);
    expect(t.rows[Col.WEIGHT]).toBe(Math.fround(0.4 * fade));
  });

  it('leaves a per-subject read to the kernel', () => {
    const m = mix<C, P>(K);
    m.sync(0);
    m.cue({ patch: wave, subjects: cells, weight: (c: C) => c.x, fade: { in: 400 } });
    m.sync(100);
    const mixer = mixerOf(m);
    const voices = [...mixer.cued];
    const t = voiceTable(mixer, voices, [{ runner: 0, values: 0, sub: 0, weights: 64 }]);
    expect(new Uint32Array(t.rows.buffer)[Col.WEIGHTS]).toBe(64);
    expect(t.rows[Col.WEIGHT]).toBe(0.25);
    const plain = voiceTable(mixer, voices, [{ runner: 0, values: 0, sub: 0 }]);
    expect(new Uint32Array(plain.rows.buffer)[Col.WEIGHTS]).toBe(NONE);
  });

  it("keeps a staggered row's weight unclamped where reads multiply in", () => {
    const four = [0, 1, 2, 3].map((x) => ({ x }));
    const read = staggered({ loop: true, weight: 1.5 }, four, { weights: 0 })(100);
    expect((read.bits[Col.FLAGS] as number) & Flag.FADE).toBe(0);
    expect(read.bits[Col.WEIGHTS]).toBe(0);
    expect(read.rows[Col.WEIGHT]).toBe(1.5);
    const plain = staggered({ loop: true, weight: 1.5 }, four)(100);
    expect((plain.bits[Col.FLAGS] as number) & Flag.FADE).toBe(0);
    expect(plain.bits[Col.WEIGHTS]).toBe(NONE);
    expect(plain.rows[Col.WEIGHT]).toBe(1);
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
