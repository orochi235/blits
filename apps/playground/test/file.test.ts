import type { Composition } from '@pg/blits/composition';
import { fileName, fromFile, toFile } from '@pg/blits/file';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { describe, expect, it } from 'vitest';

describe('file', () => {
  it('round-trips every preset', () => {
    for (const { comp } of PRESETS) expect(fromFile(toFile(comp))).toEqual(comp);
  });

  it('gives null for text that is not JSON, or JSON load refuses', () => {
    expect(fromFile('not json')).toBeNull();
    expect(fromFile('{}')).toBeNull();
    expect(fromFile(toFile({ ...DEFAULT, version: 2 } as unknown as Composition))).toBeNull();
  });

  it('names the file from the title', () => {
    expect(fileName({ ...DEFAULT, title: 'Stagger wave!' })).toBe('stagger-wave.blits.json');
    expect(fileName({ ...DEFAULT, title: '  ' })).toBe('composition.blits.json');
  });
});
