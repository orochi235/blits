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

/** Past this many voices the built-in sort, which makes working arrays however few it is given. */
const SHORT = 8;

/** Puts voices in id order in place, those of one id left in the order they had; returns `list`. */
export function byId<V extends { readonly id: number }>(list: V[]): V[] {
  if (list.length > SHORT) return list.sort((a, b) => a.id - b.id);
  for (let i = 1; i < list.length; i++) {
    const v = list[i] as V;
    let k = i;
    for (; k > 0 && (list[k - 1] as V).id > v.id; k--) list[k] = list[k - 1] as V;
    list[k] = v;
  }
  return list;
}

/** Puts `v` into a list kept in id order, after any of its id. */
export function insertById<V extends { readonly id: number }>(list: V[], v: V): void {
  let i = list.length;
  while (i > 0 && (list[i - 1] as V).id > v.id) i--;
  list.splice(i, 0, v);
}
