import { ancestorsOf } from '@pg/blits/groups';
import type { ControlRenderer } from '@weasel-js/labkit';
import { type PrefRenderContext, PropertyControl } from '@weasel-js/ui';
import { errorOf, Row, useSpec } from './SpecFields';

/** The panel writes `''` as no owner: the mix. */
const NONE = '';

/**
 * The group a voice or group plays under, chosen from those it may join: never itself or a group
 * it holds, and never a span for an owner. Writes the owner's id, or `''` for the mix.
 */
export const ownerRow: ControlRenderer = (row) => <OwnerRow row={row} />;

function OwnerRow({ row }: { row: PrefRenderContext }) {
  const spec = useSpec();
  const { comp, x } = spec;
  const self = comp.groups?.find((g) => g.id === x.id);
  const offered = (comp.groups ?? []).filter(
    (g) =>
      !self ||
      (g.id !== x.id &&
        !ancestorsOf(comp, g.id).some((a) => a.id === x.id) &&
        !(self.kind === 'owner' && g.kind === 'span')),
  );
  return (
    <Row row={row} error={errorOf(spec, 'owner')?.error}>
      <PropertyControl
        kind="enum"
        name={row.pref.name}
        value={x.owner ?? NONE}
        options={[
          { value: NONE, label: 'none (the mix)' },
          ...offered.map((g) => ({ value: g.id, label: `${g.name} · ${g.kind}` })),
        ]}
        onChange={(id) => row.setValue(id)}
      />
    </Row>
  );
}
