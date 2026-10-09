import {
  type Composition,
  type Level,
  MAX_COLS,
  MAX_GROUPS,
  MAX_LENGTH,
  MAX_LEVELS,
  MAX_ROWS,
  MAX_TEXT,
  type StageSpec,
} from './composition';

export const DEFAULT_DOTS = { cols: 12, rows: 6 } as const;
export const DEFAULT_TEXT = 'blits';

const whole = (v: number, max: number) => Math.min(Math.max(Math.round(v), 1), max);

/** The stage switched to `kind`, keeping the current one when it is that kind already. */
export function switchStage(stage: StageSpec, kind: StageSpec['kind']): StageSpec {
  if (stage.kind === kind) return stage;
  if (kind === 'dots') return { kind, ...DEFAULT_DOTS };
  return { kind, text: DEFAULT_TEXT };
}

/** A dots stage of that size, each side clamped to 1..MAX; a non-number keeps the old side. */
export function sizeDots(
  stage: { cols: number; rows: number },
  cols: number,
  rows: number,
): StageSpec {
  return {
    kind: 'dots',
    cols: Number.isFinite(cols) ? whole(cols, MAX_COLS) : stage.cols,
    rows: Number.isFinite(rows) ? whole(rows, MAX_ROWS) : stage.rows,
  };
}

/** A letters stage of `text`, cut to `MAX_TEXT` code points as `load` counts them. */
export const lettersOf = (text: string): StageSpec => ({
  kind: 'letters',
  text: [...text].slice(0, MAX_TEXT).join(''),
});

/** The composition with that length in whole ms, clamped to 1..MAX_LENGTH; a non-number changes nothing. */
export function withLength(c: Composition, ms: number): Composition {
  if (!Number.isFinite(ms)) return c;
  const length = whole(ms, MAX_LENGTH);
  return length === c.length ? c : { ...c, length };
}

/** The levels with a fresh `level N` from 0 to 1 added, or unchanged at `MAX_LEVELS`. */
export function addLevel(levels: readonly Level[]): Level[] {
  if (levels.length >= MAX_LEVELS) return [...levels];
  const names = new Set(levels.map((l) => l.name));
  let n = levels.length + 1;
  while (names.has(`level ${n}`)) n++;
  return [...levels, { name: `level ${n}`, value: 0, min: 0, max: 1 }];
}

/** Whether the composition holds `MAX_GROUPS` groups, so no edit may add another. */
export const groupsFull = (c: Composition) => (c.groups?.length ?? 0) >= MAX_GROUPS;

export const removeLevel = (levels: readonly Level[], i: number): Level[] =>
  levels.filter((_, k) => k !== i);

export const nameFree = (levels: readonly Level[], i: number, name: string) =>
  name !== '' && !levels.some((l, k) => k !== i && l.name === name);

const holdIn = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Whether every level has a distinct non-blank name, min below max, and a value within them. */
export const levelsOk = (levels: readonly Level[]) =>
  levels.every(
    (l, i) =>
      nameFree(levels, i, l.name.trim()) &&
      l.min < l.max &&
      holdIn(l.value, l.min, l.max) === l.value,
  );

/** Level `i` renamed; a blank name or one another level has leaves the levels as they were. */
export function renameLevel(levels: readonly Level[], i: number, name: string): Level[] {
  const next = name.trim();
  if (!nameFree(levels, i, next)) return [...levels];
  return levels.map((l, k) => (k === i ? { ...l, name: next } : l));
}

/**
 * Level `i` with new bounds or value. Bounds that would cross are refused, and the value is held
 * inside them, so the slider always has a range.
 */
export function tuneLevel(
  levels: readonly Level[],
  i: number,
  change: Partial<Pick<Level, 'min' | 'max' | 'value'>>,
): Level[] {
  const old = levels[i];
  if (!old || Object.values(change).some((v) => !Number.isFinite(v))) return [...levels];
  const min = change.min ?? old.min;
  const max = change.max ?? old.max;
  if (min >= max) return [...levels];
  const value = holdIn(change.value ?? old.value, min, max);
  return levels.map((l, k) => (k === i ? { ...l, min, max, value } : l));
}
