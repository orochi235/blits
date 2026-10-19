import type { Composition } from '@pg/blits/composition';
import { fromHash, load, toHash } from '@pg/blits/load';
import { createHistory, swapOp } from '@weasel-js/history';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [comp, setComp] = useState<Composition>(() => first(initial));
  const [edits] = useState(() => createHistory(null, { historyLimit: DEPTH }));
  const now = useRef(comp);
  const emit = useCallback((c: Composition) => {
    now.current = c;
    setComp(c);
  }, []);
  const set = useCallback(
    (next: Composition) => {
      if (next === now.current) return;
      edits.apply(
        swapOp({ name: 'composition', label: 'edit', before: now.current, after: next, emit }),
      );
    },
    [edits, emit],
  );
  // A shared link loads once; left in the address bar, it would overrule every edit on reload.
  useEffect(() => {
    if (new URLSearchParams(location.hash.slice(1)).has('c'))
      history.replaceState(null, '', location.pathname + location.search);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(comp));
    } catch {}
  }, [comp]);
  const share = useCallback(() => `${location.origin}${location.pathname}#${toHash(comp)}`, [comp]);
  const undo = useCallback(() => edits.undo(), [edits]);
  const redo = useCallback(() => edits.redo(), [edits]);
  return {
    comp,
    set,
    undo,
    redo,
    share,
    canUndo: edits.canUndo(),
    canRedo: edits.canRedo(),
  };
}
