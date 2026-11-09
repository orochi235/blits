/** One item laid in a buffer, at `offset` in f32s. */
export interface Laid<T> {
  readonly item: T;
  readonly offset: number;
}

/** A frame's items laid end to end from `from`, skipping each undefined one. */
export interface Layout<T> {
  readonly placed: Laid<T>[];
  /** Each item's offset, in `items` order; undefined for none. */
  readonly offsets: (number | undefined)[];
  /** Where the last one ends. */
  readonly end: number;
}

export function lay<T>(
  items: readonly (T | undefined)[],
  from: number,
  size: (item: T) => number,
): Layout<T> {
  const placed: Laid<T>[] = [];
  let at = from;
  const offsets = items.map((item) => {
    if (item === undefined) return undefined;
    const offset = at;
    placed.push({ item, offset });
    at += size(item);
    return offset;
  });
  return { placed, offsets, end: at };
}

/** Whether a layout holds other items, or the same at other offsets, than `was`. */
export function moved<T>(was: readonly Laid<T>[], placed: readonly Laid<T>[]): boolean {
  return (
    placed.length !== was.length ||
    placed.some((p, k) => p.item !== was[k]?.item || p.offset !== was[k]?.offset)
  );
}
