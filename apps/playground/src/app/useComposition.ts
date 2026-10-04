import type { Composition } from '@pg/blits/composition';
import { fromHash, load, toHash } from '@pg/blits/load';
import {
  emptyStack,
  pushSnapshot,
  redo as redoOf,
  type UndoStack,
  undo as undoOf,
} from '@weasel-js/labkit';
import { useCallback, useEffect, useState } from 'react';

interface History {
  comp: Composition;
  stack: UndoStack;
}

const DEPTH = 200;
const KEY = 'blits-playground:composition';

/** A shared link's composition, else the one last kept here, else `initial`. */
function first(initial: Composition): Composition {
  const shared = fromHash(location.hash);
  if (shared) return shared;
  try {
    const kept = localStorage.getItem(KEY);
    return (kept && load(JSON.parse(kept))) || initial;
  } catch {
    return initial;
  }
}

export function useComposition(initial: Composition) {
  const [h, setH] = useState<History>(() => ({ comp: first(initial), stack: emptyStack() }));
  const set = useCallback((next: Composition) => {
    setH((x) =>
      next === x.comp ? x : { comp: next, stack: pushSnapshot(x.stack, x.comp, DEPTH) },
    );
  }, []);
  const step = useCallback((by: typeof undoOf) => {
    setH((x) => {
      const r = by(x.stack, x.comp);
      return r ? { comp: r.snapshot as Composition, stack: r.stack } : x;
    });
  }, []);
  // A shared link loads once; left in the address bar, it would overrule every edit on reload.
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('c'))
      history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(h.comp));
    } catch {}
  }, [h.comp]);
  const share = useCallback(
    () => `${location.origin}${location.pathname}#${toHash(h.comp)}`,
    [h.comp],
  );
  const undo = useCallback(() => step(undoOf), [step]);
  const redo = useCallback(() => step(redoOf), [step]);
  return {
    comp: h.comp,
    set,
    undo,
    redo,
    share,
    canUndo: h.stack.past.length > 0,
    canRedo: h.stack.future.length > 0,
  };
}
