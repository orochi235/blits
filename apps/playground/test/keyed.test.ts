import { withKey, without } from '@pg/blits/keyed';
import { describe, expect, it } from 'vitest';

describe('withKey', () => {
  it('sets a key, or drops it for undefined', () => {
    const o: { a?: number; b?: number } = { a: 1, b: 2 };
    expect(withKey(o, 'a', 5)).toEqual({ a: 5, b: 2 });
    expect(withKey(o, 'a', undefined)).toEqual({ b: 2 });
    expect('a' in withKey(o, 'a', undefined)).toBe(false);
    expect(without(o, 'b')).toEqual({ a: 1 });
  });
});
