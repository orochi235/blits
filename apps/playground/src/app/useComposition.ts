import type { Composition } from '@pg/blits/composition';
import {
  emptyStack,
  pushSnapshot,
  redo as redoOf,
  type UndoStack,
  undo as undoOf,
} from '@weasel-js/labkit';
import { useCallback, useState } from 'react';

interface History {
  comp: Composition;
  stack: UndoStack;
}

const DEPTH = 200;

export function useComposition(initial: Composition) {
  const [h, setH] = useState<History>(() => ({ comp: initial, stack: emptyStack() }));
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
  const undo = useCallback(() => step(undoOf), [step]);
  const redo = useCallback(() => step(redoOf), [step]);
  return {
    comp: h.comp,
    set,
    undo,
    redo,
    canUndo: h.stack.past.length > 0,
    canRedo: h.stack.future.length > 0,
  };
}
