import type { Composition, Group, Voice } from '@pg/blits/composition';
import { ancestorsOf, parentOf, rowsOf, treeFault, underSpan } from '@pg/blits/groups';
import { describe, expect, it } from 'vitest';

const voice = (id: string, owner?: string): Voice => ({
  id,
  name: id,
  hue: 0,
  patch: { kind: 'keys', period: 400, stops: [] },
  start: 0,
  rate: 1,
  loop: false,
  weight: 1,
  fade: {},
  ...(owner ? { owner } : {}),
});
const group = (id: string, kind: Group['kind'] = 'owner', owner?: string): Group => ({
  id,
  name: id,
  hue: 0,
  kind,
  start: 0,
  rate: 1,
  weight: 1,
  fade: {},
  ...(owner ? { owner } : {}),
});
const comp = (voices: Voice[], groups?: Group[]): Composition => ({
  version: 1,
  title: 't',
  stage: { kind: 'dots', cols: 2, rows: 1 },
  length: 1000,
  levels: [],
  voices,
  ...(groups ? { groups } : {}),
});
const rows = (c: Composition) => rowsOf(c).map((r) => `${r.id}:${r.depth}`);

describe('rowsOf', () => {
  it("is a flat composition's voices at depth 0", () => {
    expect(rowsOf(comp([voice('a'), voice('b')]))).toEqual([
      { kind: 'voice', id: 'a', depth: 0 },
      { kind: 'voice', id: 'b', depth: 0 },
    ]);
  });

  it("keeps a group's block whole, placed at its first member", () => {
    const c = comp([voice('a', 'g1'), voice('b'), voice('c', 'g1')], [group('g1')]);
    expect(rows(c)).toEqual(['g1:0', 'a:1', 'c:1', 'b:0']);
    expect(rowsOf(c)[0]?.kind).toBe('group');
  });

  it('places a nested group at its first member, and its parent at that one', () => {
    const c = comp(
      [voice('d', 'g2'), voice('a', 'g1'), voice('b')],
      [group('g1'), group('g2', 'span', 'g1')],
    );
    expect(rows(c)).toEqual(['g1:0', 'g2:1', 'd:2', 'a:1', 'b:0']);
  });

  it('puts an empty group at the end of its parent', () => {
    const c = comp(
      [voice('a', 'g1'), voice('b')],
      [group('empty'), group('g1'), group('inner', 'owner', 'g1')],
    );
    expect(rows(c)).toEqual(['g1:0', 'a:1', 'inner:1', 'b:0', 'empty:0']);
  });
});

describe('the tree', () => {
  const c = comp(
    [voice('a', 's'), voice('b', 'g'), voice('c')],
    [group('g'), group('s', 'span', 'g')],
  );

  it('finds parents and ancestors, outermost first', () => {
    expect(parentOf(c, 'a')?.id).toBe('s');
    expect(parentOf(c, 's')?.id).toBe('g');
    expect(parentOf(c, 'c')).toBeUndefined();
    expect(ancestorsOf(c, 'a').map((g) => g.id)).toEqual(['g', 's']);
    expect(ancestorsOf(c, 'c')).toEqual([]);
  });

  it('knows what sits directly under a span', () => {
    expect(underSpan(c, 'a')).toBe(true);
    expect(underSpan(c, 'b')).toBe(false);
    expect(underSpan(c, 's')).toBe(false);
  });

  it('finds a cycle or an unknown owner, and passes a sound tree', () => {
    expect(treeFault(c)).toBeNull();
    const loop = comp([], [group('g1', 'owner', 'g2'), group('g2', 'owner', 'g1')]);
    expect(treeFault(loop)).toMatch(/cycle/);
    expect(treeFault(comp([voice('a', 'nope')]))).toMatch(/nope/);
    expect(treeFault(comp([], [group('g', 'owner', 'nope')]))).toMatch(/nope/);
  });
});
