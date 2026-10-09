import { compile } from '@pg/blits/compile';
import {
  type Composition,
  type Group,
  type Level,
  MAX_COLS,
  MAX_GROUPS,
  MAX_LENGTH,
  MAX_LEVELS,
  MAX_ROWS,
  MAX_TEXT,
} from '@pg/blits/composition';
import {
  addLevel,
  DEFAULT_DOTS,
  DEFAULT_TEXT,
  groupsFull,
  lettersOf,
  removeLevel,
  renameLevel,
  sizeDots,
  switchStage,
  tuneLevel,
  withLength,
} from '@pg/blits/edit';
import { load } from '@pg/blits/load';
import { DEFAULT } from '@pg/blits/presets';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const k: Level = { name: 'k', value: 0.5, min: 0, max: 1 };

describe('stage edits', () => {
  it('switching kind starts from a default; switching to the same kind keeps the stage', () => {
    const dots = { kind: 'dots', cols: 3, rows: 2 } as const;
    expect(switchStage(dots, 'dots')).toBe(dots);
    expect(switchStage(dots, 'letters')).toEqual({ kind: 'letters', text: DEFAULT_TEXT });
    expect(switchStage({ kind: 'letters', text: 'x' }, 'dots')).toEqual({
      kind: 'dots',
      ...DEFAULT_DOTS,
    });
  });

  it('clamps dots to 1..MAX and keeps a side given no number', () => {
    const old = { cols: 3, rows: 2 };
    expect(sizeDots(old, 999, 0)).toEqual({ kind: 'dots', cols: MAX_COLS, rows: 1 });
    expect(sizeDots(old, Number.NaN, 4.6)).toEqual({ kind: 'dots', cols: 3, rows: 5 });
    expect(MAX_ROWS).toBeGreaterThan(5);
  });

  it('cuts text to MAX_TEXT code points, as load counts them', () => {
    const long = '😀'.repeat(MAX_TEXT + 5);
    const stage = lettersOf(long);
    expect(stage.kind === 'letters' && [...stage.text].length).toBe(MAX_TEXT);
    expect(load({ ...DEFAULT, stage })).not.toBeNull();
  });
});

describe('length', () => {
  it('rounds and clamps to 1..MAX_LENGTH, ignoring a non-number', () => {
    expect(withLength(DEFAULT, 1e9).length).toBe(MAX_LENGTH);
    expect(withLength(DEFAULT, -5).length).toBe(1);
    expect(withLength(DEFAULT, Number.NaN)).toBe(DEFAULT);
    expect(withLength(DEFAULT, DEFAULT.length)).toBe(DEFAULT);
  });
});

describe('level edits', () => {
  it('adds uniquely named levels up to MAX_LEVELS and no further', () => {
    let levels: Level[] = [{ ...k, name: 'level 2' }];
    levels = addLevel(levels);
    expect(levels[1]).toEqual({ name: 'level 3', value: 0, min: 0, max: 1 });
    while (levels.length < MAX_LEVELS) levels = addLevel(levels);
    expect(addLevel(levels)).toHaveLength(MAX_LEVELS);
    expect(new Set(levels.map((l) => l.name)).size).toBe(MAX_LEVELS);
    expect(load({ ...DEFAULT, levels })).not.toBeNull();
  });

  it('renames, refusing a blank name or a taken one', () => {
    const two = [k, { ...k, name: 'j' }];
    expect(renameLevel(two, 0, ' mouse ')[0]?.name).toBe('mouse');
    expect(renameLevel(two, 0, 'j')).toEqual(two);
    expect(renameLevel(two, 0, '  ')).toEqual(two);
  });

  it('refuses crossed bounds and holds the value inside them', () => {
    expect(tuneLevel([k], 0, { min: 1 })).toEqual([k]);
    expect(tuneLevel([k], 0, { max: 0.2 })[0]).toEqual({ ...k, max: 0.2, value: 0.2 });
    expect(tuneLevel([k], 0, { value: 7 })[0]?.value).toBe(1);
    expect(tuneLevel([k], 0, { value: Number.NaN })).toEqual([k]);
    expect(removeLevel([k, { ...k, name: 'j' }], 0)).toEqual([{ ...k, name: 'j' }]);
  });

  it('an expression naming a removed or renamed level compiles, reading 0', () => {
    const c: Composition = {
      ...DEFAULT,
      levels: [k],
      voices: DEFAULT.voices.map((v) => ({ ...v, weight: { code: 'level("k")' } })),
    };
    for (const levels of [removeLevel(c.levels, 0), renameLevel(c.levels, 0, 'j')]) {
      const built = compile({ ...c, levels }, subjectsOf(c.stage));
      expect(built.errors).toEqual([]);
      expect(built.levels.has('k')).toBe(false);
    }
  });
});

describe('group cap', () => {
  it('is full at MAX_GROUPS, which load still accepts', () => {
    const group = (i: number): Group => ({
      id: `g${i}`,
      name: `g${i}`,
      hue: 0,
      kind: 'owner',
      start: 0,
      rate: 1,
      weight: 1,
      fade: {},
    });
    const groups = (n: number) => Array.from({ length: n }, (_, i) => group(i));
    expect(groupsFull(DEFAULT)).toBe(false);
    expect(groupsFull({ ...DEFAULT, groups: groups(MAX_GROUPS - 1) })).toBe(false);
    const full = { ...DEFAULT, groups: groups(MAX_GROUPS) };
    expect(groupsFull(full)).toBe(true);
    expect(load(full)).not.toBeNull();
  });
});
