import { watched } from '@msb235/blits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARK } from '../src/names.js';

const stub = (value: string | null) =>
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => (key === MARK ? value : null) });

describe('start', () => {
  afterEach(() => {
    watched().history = undefined;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('gives every later mix the history the tab asked for', async () => {
    stub('10000');
    await import('../src/start.js');
    expect(watched().history?.ms).toBe(10_000);
  });

  it('leaves history off in a tab that did not ask', async () => {
    stub(null);
    await import('../src/start.js');
    expect(watched().history).toBeUndefined();
  });
});
