import type { Composition } from '@pg/blits/composition';
import { fromHash, load, toHash } from '@pg/blits/load';
import { useCallback, useEffect, useState } from 'react';
import type { Draftable } from './drafting';
import { createEdits } from './edits';

const KEY = 'blits-playground:composition';

/** The composition last kept here, else `initial`. */
function kept(initial: Composition): Composition {
  try {
    const was = localStorage.getItem(KEY);
    return (was && load(JSON.parse(was))) || initial;
  } catch {
    return initial;
  }
}

/**
 * Opens the shared link in `hash` with `open`, and says how it went: `none` when it holds no link.
 * A link `load` refuses is left for the caller to report, never swapped for another composition.
 */
export function openLink(
  hash: string,
  open: (c: Composition) => void,
): 'none' | 'opened' | 'refused' {
  if (!new URLSearchParams(hash.replace(/^#/, '')).has('c')) return 'none';
  const shared = fromHash(hash);
  if (!shared) return 'refused';
  open(shared);
  return 'opened';
}

export function useComposition(initial: Composition) {
  const [comp, setComp] = useState<Composition>(() => kept(initial));
  const [refusedLink, setRefusedLink] = useState(false);
  const [edits] = useState(() => createEdits(comp, setComp));
  const set = edits.set;
  // A shared link opens as an edit, so undo brings back the work it replaced, and leaves the
  // address bar, where it would overrule every edit on reload. One that fails stays to retry.
  useEffect(() => {
    const take = () => {
      const how = openLink(location.hash, set);
      setRefusedLink(how === 'refused');
      if (how === 'opened') history.replaceState(null, '', location.pathname + location.search);
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, [set]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(comp));
    } catch {}
  }, [comp]);
  const share = useCallback(() => `${location.origin}${location.pathname}#${toHash(comp)}`, [comp]);
  return {
    comp,
    set,
    /** Edits shown but not yet recorded, for the controls that pass through values on the way to one. */
    drafts: edits satisfies Draftable,
    undo: edits.undo,
    redo: edits.redo,
    share,
    /** The address holds a shared link `load` refused. */
    refusedLink,
    canUndo: edits.canUndo(),
    canRedo: edits.canRedo(),
  };
}
