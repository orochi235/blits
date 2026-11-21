import { aimOf } from '@pg/app/AimField';
import type { PatchSource } from '@pg/blits/composition';
import { describe, expect, it } from 'vitest';
import { subjects } from './helpers';

const TWEEN: PatchSource = {
  kind: 'tween',
  channel: 'offset',
  opts: { from: [0, 0], to: [1, 1], ms: 300 },
};

describe('aiming a motion voice', () => {
  it('sends a value per subject, or the compile error', () => {
    expect(aimOf(TWEEN, [], subjects, '(s) => [s.col, 0]').values).toHaveLength(subjects.length);
    const bad = aimOf(TWEEN, [], subjects, '(s) => [');
    expect(bad.error).toBeTruthy();
    expect(bad.values).toBeUndefined();
  });

  it('clears the error and sends nothing for a blank expression', () => {
    expect(aimOf(TWEEN, [], subjects, '  ')).toEqual({ error: null });
  });
});
