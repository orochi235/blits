import { type Handle, type Mix, type Signal, share } from '@msb235/blits';
import type { Mixed } from './kit';
import type { Spec } from './spec';
import type { Subject } from './stage';

/**
 * Cues a blend's members, whose specs match but for `patch`, `name`, `tags` and `hits`: with
 * `mix.blend` in the full mix, and in a solo mix as plain voices of one locus, member `only` at its
 * share and the rest silent.
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
  const {
    patch: _,
    weight: __,
    locus: ___,
    name: _name,
    tags: _tags,
    hits: _hits,
    ...shared
  } = first.spec;
  const own = ({ spec }: { spec: Spec }) => ({
    patch: spec.patch,
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    ...(spec.tags !== undefined ? { tags: spec.tags } : {}),
    ...(spec.hits !== undefined ? { hits: spec.hits } : {}),
  });
  if (only === null) return m.blend(members.map(own), by, shared);
  const n = members.length;
  return members.map((r, i) => {
    const weight = r.id === only ? share(by, i, n) : 0;
    return m.cue({ ...shared, ...own(r), weight, locus: `blend ${locus}` });
  });
}
