/** A seeded xorshift generator, so a fuzz program reproduces from its seed alone. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const f = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    f,
    i: (n: number) => Math.floor(f() * n),
    pick: <T>(a: readonly T[]): T => a[Math.floor(f() * a.length)] as T,
    p: (x: number) => f() < x,
  };
}
