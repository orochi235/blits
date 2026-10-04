import type { FieldError } from '@pg/blits/compile';
import type { Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { ExprInput } from '@pg/widgets/ExprInput';
import { type ConfigField, ControlPanel, fromConfigFields } from '@weasel-js/labkit';
import s from './App.module.css';
import { docOf } from './docs';
import { WeightField } from './WeightField';

const FIELDS: ConfigField[] = [
  { key: 'name', label: 'name', type: 'text', default: '' },
  { key: 'start', label: 'start', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'rate', label: 'rate', type: 'slider', default: 1, min: 0, max: 4, step: 0.05 },
  { key: 'loopForGood', label: 'loop for good', type: 'checkbox', default: true },
  { key: 'passes', label: 'passes', type: 'number', default: 1, min: 1, step: 1 },
  { key: 'fadeIn', label: 'fade in', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'fadeOut', label: 'fade out', type: 'number', default: 0, min: 0, step: 10 },
  {
    key: 'hold',
    label: 'hold',
    type: 'select',
    default: 'none',
    options: ['none', 'before', 'after', 'both'].map((v) => ({ value: v, label: v })),
  },
  { key: 'locus', label: 'locus', type: 'text', default: '' },
  { key: 'fromCurrent', label: "from: 'current'", type: 'checkbox', default: false },
];
const resolved = fromConfigFields(FIELDS);
// `manual` keeps a row's label from toggling it to `auto`, which a voice field has no meaning for.
for (const leaf of Object.values(resolved.group.children)) Object.assign(leaf, { manual: true });
const SCHEMA = {
  ...resolved,
  sections: [
    { at: '', label: 'timing', paths: ['start', 'rate', 'loopForGood', 'passes'] },
    { at: '', label: 'fade', paths: ['fadeIn', 'fadeOut'] },
    { at: '', label: 'blending', paths: ['hold', 'locus', 'fromCurrent'] },
  ],
};

/** Errors on fields this panel has no input for, shown in a list of their own. */
const LOOSE = new Set(['name', 'cue']);

/** One edited row of the control panel, written back into the voice it came from. */
function written(v: Voice, path: string, value: unknown): Voice {
  switch (path) {
    case 'name':
    case 'locus':
      return { ...v, [path]: (value as string) || (path === 'locus' ? undefined : '') };
    case 'start':
    case 'rate':
      return Number.isFinite(value) ? { ...v, [path]: value as number } : v;
    case 'loopForGood':
      return { ...v, loop: value ? true : typeof v.loop === 'number' ? v.loop : 1 };
    case 'passes':
      return Number.isFinite(value) ? { ...v, loop: Math.max(1, Math.round(value as number)) } : v;
    case 'fadeIn':
      return Number.isFinite(value) ? { ...v, fade: { ...v.fade, in: value as number } } : v;
    case 'fadeOut':
      return Number.isFinite(value) ? { ...v, fade: { ...v.fade, out: value as number } } : v;
    case 'hold':
      return { ...v, hold: value === 'none' ? undefined : (value as Voice['hold']) };
    case 'fromCurrent':
      return { ...v, from: value ? 'current' : undefined };
    default:
      return v;
  }
}

export interface VoicePanelProps {
  voice: Voice;
  errors: FieldError[];
  faults: Faults | undefined;
  onChange(v: Voice): void;
  onDelete(): void;
}

export function VoicePanel({ voice: v, errors, faults, onChange, onDelete }: VoicePanelProps) {
  const mine = errors.filter((e) => e.voice === v.id);
  const errorOf = (field: string) => mine.find((e) => e.field === field)?.error ?? null;
  const loose = mine.filter((e) => LOOSE.has(e.field));
  const config = {
    name: v.name,
    start: v.start,
    rate: v.rate,
    loopForGood: v.loop === true,
    passes: typeof v.loop === 'number' ? v.loop : 1,
    fadeIn: v.fade.in ?? 0,
    fadeOut: v.fade.out ?? 0,
    hold: v.hold ?? 'none',
    locus: v.locus ?? '',
    fromCurrent: v.from === 'current',
  };
  return (
    <section className={s.panel} aria-label={`voice ${v.name}`}>
      <ControlPanel
        title={`voice · ${v.name}`}
        schema={SCHEMA}
        config={config}
        setConfig={(path, value) => onChange(written(v, path, value))}
      />
      {loose.length > 0 && (
        <div role="alert">
          <ul className={s.errors} aria-label="voice errors">
            {loose.map((e) => (
              <li key={e.field}>
                {e.field}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ExprInput
        label="stagger"
        placeholder="(s) => s.col * 80"
        value={v.stagger?.code ?? ''}
        error={errorOf('stagger')}
        onCommit={(code) => onChange({ ...v, stagger: code ? { code } : undefined })}
      />
      <ExprInput
        label="target"
        placeholder="(s) => s.row === 0"
        value={v.target?.code ?? ''}
        error={errorOf('target')}
        onCommit={(code) => onChange({ ...v, target: code ? { code } : undefined })}
      />
      <WeightField
        value={v.weight}
        error={errorOf('weight')}
        onChange={(weight) => onChange({ ...v, weight })}
      />
      {faults && faults.count > 0 && (
        <p className={s.fault} role="status">
          {faults.count} calls threw; first: {faults.first}
        </p>
      )}
      <p className={s.row} title={docOf('VoiceSpec.anchor')}>
        anchor: {v.anchor ? JSON.stringify(v.anchor) : 'none'}
        {v.anchor && (
          <button type="button" onClick={() => onChange({ ...v, anchor: undefined })}>
            clear
          </button>
        )}
      </p>
      <button type="button" onClick={onDelete}>
        delete voice
      </button>
    </section>
  );
}
