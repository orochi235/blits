import { describe, expect, it } from 'vitest';
import { qualify } from '../src/qualify.js';

describe('qualify', () => {
  it('lanes every numeric channel whose writers all fit', () => {
    const r = qualify(
      [true, true, false],
      [
        { id: 1, fits: true, slots: [0] },
        { id: 2, fits: true, slots: [1] },
      ],
    );
    expect(r.channels).toEqual([true, true, false]);
    expect([...r.voices]).toEqual([1, 2]);
  });

  it('takes a channel off its lane when a writer does not fit, and every voice writing it', () => {
    const r = qualify(
      [true, true],
      [
        { id: 1, fits: true, slots: [0, 1] },
        { id: 2, fits: false, slots: [1] },
      ],
    );
    expect(r.channels).toEqual([false, false]);
    expect([...r.voices]).toEqual([]);
  });

  it('follows a chain of shared channels to the fixed point', () => {
    // 3 does not fit and writes c; 2 writes b and c; 1 writes a and b. All of a, b, c fall.
    const r = qualify(
      [true, true, true, true],
      [
        { id: 1, fits: true, slots: [0, 1] },
        { id: 2, fits: true, slots: [1, 2] },
        { id: 3, fits: false, slots: [2] },
        { id: 4, fits: true, slots: [3] },
      ],
    );
    expect(r.channels).toEqual([false, false, false, true]);
    expect([...r.voices]).toEqual([4]);
  });

  it('keeps a voice off its lane when it writes a channel that is not numeric', () => {
    const r = qualify([true, false], [{ id: 1, fits: true, slots: [0, 1] }]);
    expect(r.channels).toEqual([false, false]);
    expect([...r.voices]).toEqual([]);
  });

  it('lanes only channels some laned voice writes', () => {
    const r = qualify([true, true], [{ id: 1, fits: true, slots: [0] }]);
    expect(r.channels).toEqual([true, false]);
  });
});
