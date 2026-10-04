import { CHANNELS, KIT } from '@pg/blits/kit';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

describe('subjectsOf', () => {
  it('lays dots out row by row, x and y in 0..1', () => {
    const s = subjectsOf({ kind: 'dots', cols: 3, rows: 2 });
    expect(s.length).toBe(6);
    expect(s[4]).toEqual({ index: 4, row: 1, col: 1, x: 0.5, y: 1, char: '' });
  });
  it('makes one subject per letter, spaces included', () => {
    const s = subjectsOf({ kind: 'letters', text: 'a b' });
    expect(s.map((x) => x.char)).toEqual(['a', ' ', 'b']);
    expect(s[2]).toMatchObject({ index: 2, row: 0, col: 2, x: 1, y: 0 });
  });
  it('a single column or row sits at 0', () => {
    expect(subjectsOf({ kind: 'dots', cols: 1, rows: 1 })[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('the kit', () => {
  it('has the six channels in drawing order', () => {
    expect(CHANNELS).toEqual(['offset', 'turn', 'scale', 'color', 'opacity', 'glow']);
    expect(Object.keys(KIT).sort()).toEqual([...CHANNELS].sort());
  });
});
