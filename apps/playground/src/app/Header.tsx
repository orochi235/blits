import type { Composition } from '@pg/blits/composition';
import { PRESETS } from '@pg/blits/presets';
import { PropertyField } from '@weasel-js/ui';
import { CompFields } from './CompositionControls';
import r from './Rows.module.css';

/** The header's preset menu, which shows the title while the composition is no preset as loaded, then title and length. */
export function Header({
  comp,
  onComp,
  onPreset,
}: {
  comp: Composition;
  onComp: (c: Composition) => void;
  onPreset: (name: string) => void;
}) {
  return (
    <div className={r.bar}>
      <PropertyField
        hug
        layout="inline"
        label="preset"
        kind="enum"
        value={PRESETS.find((x) => x.comp === comp)?.name}
        placeholder={comp.title}
        options={PRESETS.map((x) => ({ value: x.name, label: x.name }))}
        onChange={onPreset}
      />
      <CompFields comp={comp} onChange={onComp} />
    </div>
  );
}
