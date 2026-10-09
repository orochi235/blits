import { compile } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { clipsOf, type Score } from '@pg/blits/score';
import type { Subject } from '@pg/blits/stage';
import { useMemo, useState } from 'react';

/**
 * The score of `comp`, and the folds it is viewed with, which are not part of the composition.
 * With groups, a compile of its own that never syncs reads where blits placed what they hold.
 */
export function useScore(
  comp: Composition,
  subjects: readonly Subject[],
): Score & { fold(id: string, on: boolean): void } {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const placing = useMemo(
    () => (comp.groups?.length ? compile(comp, subjects) : undefined),
    [comp, subjects],
  );
  const score = useMemo(
    () => clipsOf(comp, subjects, { built: placing, folded }),
    [comp, subjects, placing, folded],
  );
  const fold = (id: string, on: boolean) =>
    setFolded((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return { ...score, fold };
}
