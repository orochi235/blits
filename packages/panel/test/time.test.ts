import { describe, expect, it } from 'vitest';
import { clockText } from '../src/ui/time.js';

describe('clockText', () => {
  it('reads seconds under a minute', () => {
    expect(clockText(0)).toBe('0.00s');
    expect(clockText(59_994)).toBe('59.99s');
  });

  it('carries into minutes and hours', () => {
    expect(clockText(60_000)).toBe('1:00.00');
    expect(clockText(65_200)).toBe('1:05.20');
    expect(clockText(3_600_000)).toBe('1:00:00.00');
    expect(clockText(7_387_500)).toBe('2:03:07.50');
  });

  it('marks a reading that is not a time', () => {
    expect(clockText(Number.NaN)).toBe('—');
    expect(clockText(-1500)).toBe('-1.50s');
  });
});
