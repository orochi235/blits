/**
 * A WeakMap every copy of blits loaded in one realm shares, so a fact one copy records about a
 * patch or channel it made is read by another copy's mix. The name carries a version, bumped when
 * what is stored changes shape, so copies that disagree on the shape keep apart.
 */
export function shared<K extends object, V>(name: string): WeakMap<K, V> {
  const key = Symbol.for(`@msb235/blits/${name}`);
  const g = globalThis as unknown as Record<symbol, WeakMap<K, V> | undefined>;
  let map = g[key];
  if (map === undefined) {
    map = new WeakMap();
    g[key] = map;
  }
  return map;
}
