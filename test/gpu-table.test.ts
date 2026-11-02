import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { eligibility } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { gpuDescriptor, shaderPatch } from '../src/gpu/shader-patch.js';
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
const shaders = new Map([[gpuDescriptor(wave)?.shader as never, 0]]);
const cells = [{ x: 0 }, { x: 1 }];

describe('voice table', () => {
  it('gives the phase and weight the CPU folds with', () => {
    const m = mix<C, P>(K, { history: { ms: 5000, tape: createHistory } });
    const h = m.cue({ patch: wave, subjects: cells, loop: true, fade: { in: 400 } });
    m.sync(0);
    m.sync(250);
    const e = eligibility(mixerOf(m), cells);
    const t = voiceTable(mixerOf(m), e.voices, shaders);
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
    const t = voiceTable(mixerOf(m), eligibility(mixerOf(m), cells).voices, shaders);
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

  it('keeps a channel whose rule has no WGSL on the CPU', () => {
    const m = mix<C, { r: number[] }>(kit({ r: quat() }));
    m.sync(0);
    expect(eligibility(mixerOf(m), cells).channels.size).toBe(0);
  });
});
