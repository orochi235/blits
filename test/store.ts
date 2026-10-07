import type { HistoryStore, Paged } from '../src/types.js';

/** A history store that keeps every record as plain data, one per key and time, and hands all back. */
export function memoryStore(): HistoryStore & { held: Map<string, Paged>; loads: number } {
  const held = new Map<string, Paged>();
  const id = (p: Paged) => [p.mix, p.stream, p.voice, p.subject, p.at].join('|');
  const store = {
    held,
    loads: 0,
    page(out: readonly Paged[]) {
      for (const p of out) held.set(id(p), structuredClone(p));
    },
    async load(_t: number) {
      store.loads++;
      return [...held.values()].map((p) => structuredClone(p));
    },
    cut(t: number) {
      for (const [k, p] of held) if (p.at > t) held.delete(k);
    },
  };
  return store;
}
