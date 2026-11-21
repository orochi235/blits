import { freshVoice } from '@pg/app/freshVoice';
import type { Voice } from '@pg/blits/composition';
import { describe, expect, it } from 'vitest';
import { group, voice } from './helpers';

const patch: Voice['patch'] = { kind: 'keys', period: 1000, stops: [] };

describe('freshVoice', () => {
  it('names the voice apart from the groups too, which share the name space', () => {
    const v = freshVoice({
      voices: [voice({ id: 'a', patch })],
      groups: [group({ id: 'voice 2' })],
    });
    expect(v.name).toBe('voice 3');
  });

  it('names the voice apart from the other voices', () => {
    const v = freshVoice({ voices: [voice({ id: 'voice 2', patch })] });
    expect(v.name).toBe('voice 3');
  });
});
