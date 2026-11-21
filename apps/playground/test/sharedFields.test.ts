import { sharedConfig, writtenShared } from '@pg/app/SpecFields';
import type { Voice } from '@pg/blits/composition';
import { describe, expect, it } from 'vitest';
import { group, voice } from './helpers';

const patch: Voice['patch'] = { kind: 'keys', period: 1000, stops: [] };

describe("the shared rows' fade in", () => {
  it('shows an unset fade in as unset, not 0, since a rise reads them apart', () => {
    expect(sharedConfig(voice({ id: 'a', patch, fade: { out: 600 } })).fadeIn).toBeUndefined();
    expect(sharedConfig(voice({ id: 'a', patch, fade: { in: 0 } })).fadeIn).toBe(0);
  });

  it('unsets the fade in when emptied, on a voice and a group', () => {
    for (const x of [
      voice({ id: 'a', patch, fade: { in: 100, out: 600 } }),
      group({ id: 'g', fade: { in: 100, out: 600 } }),
    ]) {
      const next = writtenShared(x, 'fadeIn', undefined);
      expect(next?.fade).toEqual({ out: 600 });
      expect(writtenShared(x, 'fadeIn', -5)?.fade.in).toBe(0);
    }
  });
});
