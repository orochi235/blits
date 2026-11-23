import { describe, expect, it } from 'vitest';
import { Ids } from '../src/ids.js';

describe('subject ids', () => {
  it('forgets a number or string subject once no list holds it', () => {
    const ids = new Ids();
    const gone = ids.of(7);
    const kept = ids.of('kept');
    ids.prune((s) => s === 'kept');
    expect(ids.get(gone)).toBeUndefined();
    expect(ids.get(kept)).toBe('kept');
    // A subject forgotten and seen again gets a fresh id.
    expect(ids.of(7)).not.toBe(gone);
  });

  it('keeps an object subject while it lives, listed or not', () => {
    const ids = new Ids();
    const o = {};
    const id = ids.of(o);
    ids.prune(() => false);
    expect(ids.get(id)).toBe(o);
  });
});
