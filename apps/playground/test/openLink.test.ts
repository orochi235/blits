import { openLink } from '@pg/app/useComposition';
import type { Composition } from '@pg/blits/composition';
import { toHash } from '@pg/blits/load';
import { describe, expect, it } from 'vitest';
import { comp, voice } from './helpers';

const c = comp([voice({ id: 'a', patch: { kind: 'keys', period: 1000, stops: [] } })]);

describe('openLink', () => {
  it("opens a shared link's composition through the edit it is given", () => {
    const opened: Composition[] = [];
    expect(openLink(`#${toHash(c)}`, (x) => opened.push(x))).toBe('opened');
    expect(opened).toHaveLength(1);
    expect(opened[0]?.voices.map((v) => v.id)).toEqual(['a']);
  });

  it('refuses a link that loads nothing, and opens nothing in its place', () => {
    const opened: Composition[] = [];
    expect(openLink(`#${toHash(c).slice(0, 12)}`, (x) => opened.push(x))).toBe('refused');
    expect(openLink('#c=', (x) => opened.push(x))).toBe('refused');
    expect(opened).toEqual([]);
  });

  it('opens nothing for an address with no link', () => {
    expect(openLink('', () => {})).toBe('none');
    expect(openLink('#x=1', () => {})).toBe('none');
  });
});
