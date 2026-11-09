/** Searches and inserts over lists kept in order. */

/** The last entry taken before `t`, or at it where `inclusive` says so. */
export function last<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean | ((e: T) => boolean),
): T | undefined {
  return list[lastIndex(list, t, inclusive)];
}

/** Where `last` finds its entry in the list, from index `lo` on; -1 where it finds none. */
export function lastIndex<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean | ((e: T) => boolean),
  lo = 0,
): number {
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = list[mid] as T;
    if (e.at < t || (e.at === t && (typeof inclusive === 'function' ? inclusive(e) : inclusive))) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
