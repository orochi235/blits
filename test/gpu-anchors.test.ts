import { describe, expect, it } from 'vitest';
import { Anchors, DRIFT, SECOND } from '../src/gpu/anchors.js';

describe('Anchors', () => {
  it('counts every row from the first frame, then nothing while the time stays near', () => {
    const a = new Anchors();
    expect(a.step(Number.NaN, 10)).toBeNull();
    expect(a.step(5, 10)).toBe('all');
    expect(a.anchor).toBe(5);
    expect(a.step(5 + DRIFT, 10)).toBeNull();
    expect(a.times(105)).toEqual([100, 0]);
  });

  it('moves rows to a new anchor a share a frame once the time drifts past', () => {
    const a = new Anchors();
    a.step(0, 10_000);
    const t = DRIFT + 1;
    expect(a.step(t, 10_000)).toEqual([0, 4096]);
    expect([a.cur, a.at[0], a.at[1]]).toEqual([1, 0, t]);
    expect(a.times(t + 10)).toEqual([t + 10, 10]);
    expect(a.step(t + 16, 10_000)).toEqual([4096, 8192]);
    expect(a.step(t + 32, 10_000)).toEqual([8192, 10_000]);
    // Every row moved, the old anchor goes unused.
    expect(a.at[0]).toBeNaN();
    expect(a.step(t + 48, 10_000)).toBeNull();
  });

  it('moves a 64th of the rows a frame where that is more', () => {
    const a = new Anchors();
    a.step(0, 640_000);
    expect(a.step(DRIFT + 1, 640_000)).toEqual([0, 10_000]);
  });

  it('counts every row from the time at once after a jump, moving or not', () => {
    const a = new Anchors();
    a.step(0, 10_000);
    expect(a.step(-5, 10_000)).toBeNull();
    expect(a.step(1e6, 10_000)).toBe('all');
    expect(a.anchor).toBe(1e6);
    a.step(1e6 + DRIFT + 1, 10_000);
    expect(a.step(1e6 - DRIFT, 10_000)).toBe('all');
    expect(a.at.filter((x) => !Number.isNaN(x))).toEqual([1e6 - DRIFT]);
  });

  it("marks a row's flags with the anchor it counts from, keeping the rest", () => {
    const a = new Anchors();
    a.step(0, 10);
    expect(a.mark(5 | SECOND)).toBe(5);
    a.step(DRIFT + 1, 10);
    expect(a.mark(5)).toBe(5 | SECOND);
  });
});
