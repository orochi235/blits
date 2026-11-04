import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { eligibility, within } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Regions } from '../src/gpu/region.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { Col, ROW, voiceTable } from '../src/gpu/table.js';
import { kit, mix, quat, sum } from '../src/index.js';

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

describe('voice table', () => {
  it('gives the phase and weight the CPU folds with', () => {
    const m = mix<C, P>(K, { history: { ms: 5000, tape: createHistory } });
    const h = m.cue({ patch: wave, subjects: cells, loop: true, fade: { in: 400 } });
    m.sync(0);
    m.sync(250);
    const e = eligibility(mixerOf(m), cells);
    const t = voiceTable(mixerOf(m), e.voices, slots);
    m.probe(cells[0] as C);
    expect(t.count).toBe(1);
    expect(t.rows[Col.PHASE]).toBeCloseTo(0.25, 6);
    expect(t.rows[Col.WEIGHT]).toBeCloseTo(h.weightOf(cells[0] as C), 6);
    expect(t.rows[Col.WEIGHT]).toBeGreaterThan(0);
    expect(t.rows[Col.WEIGHT]).toBeLessThan(1);
  });

  it('marks the first member of each role', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, role: 'a' });
    m.cue({ patch: wave, subjects: cells, role: 'a' });
    m.cue({ patch: wave, subjects: cells });
    m.sync(0);
    const t = voiceTable(mixerOf(m), eligibility(mixerOf(m), cells).voices, slots);
    expect([t.rows[Col.ROLE], t.rows[ROW + Col.ROLE], t.rows[2 * ROW + Col.ROLE]]).toEqual([
      1, 1, 0,
    ]);
    expect([t.rows[Col.FIRST], t.rows[ROW + Col.FIRST]]).toEqual([1, 0]);
  });

  it('keeps a channel on the CPU, with a reason, when a voice reads a weight signal', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: () => 0.5 });
    m.sync(0);
    const e = eligibility(mixerOf(m), cells);
    expect(e.channels.has('y')).toBe(false);
    expect(e.reasons[0]?.why).toMatch(/weight signal/);
  });

  it('keeps a channel on the CPU when a voice misses a registered subject', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: [cells[0] as C] });
    m.sync(0);
    expect(eligibility(mixerOf(m), cells).channels.has('y')).toBe(false);
  });

  it('asks again whether a voice reaches every subject when the list changes', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: [cells[0] as C] });
    m.sync(0);
    const one = [cells[0] as C];
    expect(eligibility(mixerOf(m), one).channels.has('y')).toBe(true);
    expect(eligibility(mixerOf(m), cells).channels.has('y')).toBe(false);
    expect(eligibility(mixerOf(m), one).channels.has('y')).toBe(true);
  });

  it('keeps a channel whose rule has no WGSL on the CPU', () => {
    const m = mix<C, { r: number[] }>(kit({ r: quat() }));
    m.sync(0);
    expect(eligibility(mixerOf(m), cells).channels.size).toBe(0);
  });

  it('writes the values and per-subject offsets as u32 bits, exact past 2^24', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, loop: true });
    m.sync(0);
    const e = eligibility(mixerOf(m), cells);
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
    const e = eligibility(mixerOf(m), cells);
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
    expect(eligibility(mixerOf(m), cells).channels.has('y')).toBe(true);
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
