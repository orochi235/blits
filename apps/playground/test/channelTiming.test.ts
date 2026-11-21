import { channelEase } from '@pg/app/ChannelTiming';
import { describe, expect, it } from 'vitest';

describe("a channel's own ease", () => {
  it('turning steps off gives a channel a curve of its own when the patch is stepped', () => {
    expect(channelEase({ steps: 4 }, undefined)).toBe('linear');
    expect(channelEase('ease-in', undefined)).toBe('linear');
  });

  it('is left unset when the patch already eases by the default', () => {
    expect(channelEase(undefined, undefined)).toBeUndefined();
    expect(channelEase('linear', undefined)).toBeUndefined();
    expect(channelEase({ steps: 4 }, 'ease-out')).toBe('ease-out');
  });
});
