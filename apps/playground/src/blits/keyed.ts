export function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const { [key]: _, ...rest } = o;
  return rest;
}

/** `o` with `key` set to `value`, or without the key when `value` is undefined. */
export function withKey<T extends object, K extends keyof T>(
  o: T,
  key: K,
  value: T[K] | undefined,
): T {
  return (value === undefined ? without(o, key) : { ...o, [key]: value }) as T;
}
