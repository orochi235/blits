import { describe, expect, it } from 'vitest';
import type { Sample } from '../src/protocol.js';
import { Samples } from '../src/store.js';

const at = (now: number, x = now): Sample => ({
  now,
  values: { x },
  weights: { 1: 1 },
  read: false,
});

describe('the samples a plot keeps', () => {
  it('replaces a sample at the time of the last, as paused frames come', () => {
    const s = new Samples();
    s.push(at(0));
    s.push(at(16, 1));
    s.push(at(16, 2));
    s.push(at(16, 3));
    expect(s.series().times).toEqual([0, 16]);
    expect(s.series().values.get('x')).toEqual([0, 3]);
  });

  it('drops what lies ahead of a seek back', () => {
    const s = new Samples();
    for (const t of [0, 100, 200, 300]) s.push(at(t));
    s.push(at(150));
    expect(s.series().times).toEqual([0, 100, 150]);
  });

  it('keeps only the window, and never more than the cap', () => {
    const s = new Samples(1000, 5);
    for (let t = 0; t <= 2000; t += 100) s.push(at(t));
    expect(s.series().times).toEqual([1600, 1700, 1800, 1900, 2000]);
    const w = new Samples(1000, 1000);
    for (let t = 0; t <= 2000; t += 100) w.push(at(t));
    expect(w.series().times[0]).toBe(1000);
  });

  it('fills a key a sample lacks with NaN, and lays weights out by voice', () => {
    const s = new Samples();
    s.push({ now: 0, values: { x: 1 }, weights: {}, read: true });
    s.push({ now: 10, values: { x: 2, y: 5 }, weights: { 3: 0.5 }, read: false });
    const { values, weights, read } = s.series();
    expect(values.get('y')).toEqual([Number.NaN, 5]);
    expect(weights.get(3)).toEqual([Number.NaN, 0.5]);
    expect(read).toEqual([true, false]);
  });
});
