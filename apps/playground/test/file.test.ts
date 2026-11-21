import { download } from '@pg/app/FileButtons';
import type { Composition } from '@pg/blits/composition';
import { fileName, fromFile, toFile } from '@pg/blits/file';
import { DEFAULT, PRESETS } from '@pg/blits/presets';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  describe('saving', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('keeps the blob URL until the click has had its task', () => {
      vi.useFakeTimers();
      const order: string[] = [];
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => order.push('revoke'));
      const a = { href: '', download: '', click: () => order.push(`click ${a.download}`) };
      vi.stubGlobal('document', { createElement: () => a });
      download(new Blob(['{}']), 'c.json');
      expect(order).toEqual(['click c.json']);
      vi.runAllTimers();
      expect(order).toEqual(['click c.json', 'revoke']);
    });
  });
});
