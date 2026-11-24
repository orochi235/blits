import type { Composition } from '@pg/blits/composition';
import { PRESETS } from '@pg/blits/presets';
import { Button, PropertyField } from '@weasel-js/ui';
import { CompFields } from './CompositionControls';
import r from './Rows.module.css';

export interface HeaderProps {
  comp: Composition;
  onComp: (c: Composition) => void;
  onPreset: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** The header's undo and redo, its preset menu, which shows the title while the composition is no preset as loaded, then title and length. */
export function Header({ comp, onComp, onPreset, canUndo, canRedo, onUndo, onRedo }: HeaderProps) {
  return (
    <div className={r.bar}>
      <div className={r.controls}>
        <Button size="sm" disabled={!canUndo} onClick={onUndo}>
          undo
        </Button>
        <Button size="sm" disabled={!canRedo} onClick={onRedo}>
          redo
        </Button>
      </div>
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
