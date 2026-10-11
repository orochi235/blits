import { type Handle, input, type Mix, type Signal } from '@msb235/blits';
import { shareOf } from './blend';
import type { Mixed } from './kit';
import type { Spec } from './spec';
import type { Subject } from './stage';

/**
 * Cues a blend's members, whose specs match but for `patch`: with `mix.blend` in the full mix, and
 * in a solo mix as plain voices of one locus, member `only` at its share and the rest silent.
 */
export function cueBlend(
  m: Mix<Subject, Mixed>,
  members: readonly { id: string; spec: Spec }[],
  by: Signal<Subject>,
  locus: string,
  only: string | null,
): Handle<Subject>[] {
  const [first] = members;
  if (!first) return [];
  const { patch: _, weight: __, locus: ___, ...shared } = first.spec;
  if (only === null)
    return m.blend(
      members.map((r) => r.spec.patch),
      by,
      shared,
    );
  const n = members.length;
  return members.map((r, i) => {
    const share: Signal<Subject> = (s, setting) => shareOf(by(s, setting), i, n);
    const weight = r.id === only ? input(share, [by]) : 0;
    return m.cue({ ...shared, patch: r.spec.patch, weight, locus: `blend ${locus}` });
  });
}
