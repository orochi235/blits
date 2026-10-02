import {
  Bezier,
  ColorRange,
  type ConstantValue,
  type IntervalValue,
  PiecewiseBezier,
  Vector4,
} from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { Authored } from '../src/authored.js';
import { system } from './fixtures.js';

const all = { speed: true, size: true, life: true, tint: true };

describe('Authored', () => {
  it('scales from what the host authored and puts it back', () => {
    const s = system();
    const a = new Authored(s, all);
    a.apply({ speed: 2, size: 3, life: 0.5, tint: [0.5, 1, 2, 1] });
    expect((s.startSpeed as ConstantValue).value).toBe(10);
    expect([(s.startSize as IntervalValue).a, (s.startSize as IntervalValue).b]).toEqual([
      0.1 * 3,
      0.2 * 3,
    ]);
    expect((s.startLife as ConstantValue).value).toBe(1);
    a.restore();
    expect((s.startSpeed as ConstantValue).value).toBe(5);
    expect([(s.startSize as IntervalValue).a, (s.startSize as IntervalValue).b]).toEqual([
      0.1, 0.2,
    ]);
  });

  it('never compounds, however many times it applies', () => {
    const s = system();
    const a = new Authored(s, all);
    for (let i = 0; i < 50; i++) a.apply({ speed: 2 });
    expect((s.startSpeed as ConstantValue).value).toBe(10);
  });

  it('leaves alone a field whose channel is not applied, whatever generates it', () => {
    const curve = new PiecewiseBezier([[new Bezier(1, 1, 1, 1), 0]]);
    const range = new ColorRange(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 1));
    const s = system({ startSize: curve, startColor: range });
    const a = new Authored(s, { speed: true, size: false, life: false, tint: false });
    a.apply({ speed: 2, size: 9, tint: [0, 0, 0, 0] });
    expect(s.startSize).toBe(curve);
    expect(s.startColor).toBe(range);
  });

  it('refuses a generator it cannot scale, naming the field', () => {
    const curve = new PiecewiseBezier([[new Bezier(1, 1, 1, 1), 0]]);
    expect(() => new Authored(system({ startSize: curve }), all)).toThrow(/startSize/);
    const range = new ColorRange(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 1));
    expect(() => new Authored(system({ startColor: range }), all)).toThrow(/startColor/);
  });

  it('refuses a system that does not emit in world space', () => {
    expect(() => new Authored(system({ worldSpace: false }), all)).toThrow(/worldSpace/);
  });
});
