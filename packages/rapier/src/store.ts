import type { HistoryStore, Paged } from '@msb235/blits';

/** The subject key the world's frame records go under in a history store, on the `host` stream. */
export const FRAMES = 'blits-rapier frames';

/** A world paging its frames through a store: whose they are, and how to take them back. */
export interface Pages {
  ours(r: Paged): boolean;
  restore(records: readonly Paged[], from: number): void;
  name: string;
}

export const paging = new WeakMap<HistoryStore, Set<Pages>>();

/**
 * Wraps a history store so the worlds of physics mixes on a transport page their log of each
 * frame's pushes through it, and get it back on `prepare`. Make the transport with
 * `history: { ..., store: physicsStore(store) }`; a mix made alone wraps its own store.
 */
export function physicsStore(store: HistoryStore): HistoryStore {
  const worlds = new Set<Pages>();
  const wrapped: HistoryStore = {
    page: (out) => store.page(out),
    cut: (seq) => store.cut(seq),
    async load(t) {
      const all = await store.load(t);
      for (const w of worlds) {
        // A replay to t starts from the world's latest copy at or before it, which needs the frames from there.
        let from = Number.NEGATIVE_INFINITY;
        for (const r of all)
          if (
            r.mix === w.name &&
            r.stream === 'snap' &&
            r.subject === 'world' &&
            r.at <= t &&
            r.at > from
          )
            from = r.at;
        if (from === Number.NEGATIVE_INFINITY) from = t;
        w.restore(from < t ? await store.load(from) : all, from);
      }
      return all.filter((r) => !(r.stream === 'host' && r.subject === FRAMES));
    },
  };
  paging.set(wrapped, worlds);
  return wrapped;
}
