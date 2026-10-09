import { type Built, compile } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { clipsOf, type Score } from '@pg/blits/score';
import type { Subject } from '@pg/blits/stage';
import { useMemo, useState } from 'react';

/**
 * The score of `comp`, and the folds it is viewed with, which are not part of the composition.
 * A compile of its own that never syncs reads where blits placed each clip; `built` is that
 * compile, which `applyEdit` reads a move against.
 */
export function useScore(
  comp: Composition,
  subjects: readonly Subject[],
): Score & { built: Built; fold(id: string, on: boolean): void } {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const built = useMemo(() => compile(comp, subjects), [comp, subjects]);
  const score = useMemo(
    () => clipsOf(comp, subjects, { built, folded }),
    [comp, subjects, built, folded],
  );
  const fold = (id: string, on: boolean) =>
    setFolded((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return { ...score, built, fold };
}
