import type { Composition, Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ExprInput } from '@pg/widgets/ExprInput';
import { type ConfigField, ControlPanel, fromConfigFields } from '@weasel-js/labkit';
import s from './App.module.css';
import { docOf } from './docs';
import { EaseField } from './EaseField';
import { HintsFields } from './HintsFields';
import { OwnerField } from './OwnerField';
import { WeightField } from './WeightField';

const FIELDS: ConfigField[] = [
  { key: 'name', label: 'name', type: 'text', default: '' },
  { key: 'start', label: 'start', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'rate', label: 'rate', type: 'slider', default: 1, min: 0, max: 4, step: 0.05 },
  { key: 'repeat', label: 'repeat', type: 'checkbox', default: true },
  { key: 'passes', label: 'passes', type: 'number', default: 1, min: 1, step: 1 },
  { key: 'fadeIn', label: 'fade in', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'fadeOut', label: 'fade out', type: 'number', default: 0, min: 0, step: 10 },
  {
    key: 'freeze',
    label: 'freeze',
    type: 'select',
    default: 'none',
    options: ['none', 'before', 'after', 'both'].map((v) => ({ value: v, label: v })),
  },
  { key: 'locus', label: 'locus', type: 'text', default: '' },
  { key: 'fromCurrent', label: "from: 'current'", type: 'checkbox', default: false },
];
/** The `VoiceSpec` member each row writes, whose doc comment it shows. */
const SPEC_KEY: Record<string, string> = {
  name: 'name',
  start: 'start',
  rate: 'rate',
  repeat: 'loop',
  passes: 'loop',
  fadeIn: 'fade',
  fadeOut: 'fade',
  freeze: 'freeze',
  locus: 'locus',
  fromCurrent: 'from',
};

function schemaOf(fields: ConfigField[]) {
  const resolved = fromConfigFields(fields);
  // `manual` keeps a row's label from toggling it to `auto`, which a voice field has no meaning for.
  for (const [key, leaf] of Object.entries(resolved.group.children))
    Object.assign(leaf, { manual: true, description: docOf(`VoiceSpec.${SPEC_KEY[key]}`) ?? '' });
  const has = (path: string) => fields.some((f) => f.key === path);
  return {
    ...resolved,
    sections: [
      { at: '', label: 'timing', paths: ['start', 'rate', 'repeat', 'passes'].filter(has) },
      { at: '', label: 'fade', paths: ['fadeIn', 'fadeOut'] },
      { at: '', label: 'blending', paths: ['freeze', 'locus', 'fromCurrent'] },
    ],
  };
}
const SCHEMA = schemaOf(FIELDS);
/** Under a span, `start` is drawn on its own, disabled, since the span places the voice. */
const SPAN_SCHEMA = schemaOf(FIELDS.filter((f) => f.key !== 'start'));

/** Errors on fields this panel has no input for, shown in a list of their own. */
const LOOSE = new Set(['name', 'cue', 'start', 'anchor', 'loop']);

/** One edited row of the control panel, written back into the voice it came from. */
function written(v: Voice, path: string, value: unknown): Voice {
  switch (path) {
    case 'name':
    case 'locus':
      return { ...v, [path]: (value as string) || (path === 'locus' ? undefined : '') };
    case 'start':
    case 'rate':
      return Number.isFinite(value) ? { ...v, [path]: value as number } : v;
    case 'repeat':
      return { ...v, loop: value ? true : typeof v.loop === 'number' ? v.loop : 1 };
    case 'passes':
      return Number.isFinite(value) ? { ...v, loop: Math.max(1, Math.round(value as number)) } : v;
    case 'fadeIn':
      return Number.isFinite(value) ? { ...v, fade: { ...v.fade, in: value as number } } : v;
    case 'fadeOut':
      return Number.isFinite(value) ? { ...v, fade: { ...v.fade, out: value as number } } : v;
    case 'freeze':
      return { ...v, freeze: value === 'none' ? undefined : (value as Voice['freeze']) };
    case 'fromCurrent':
      return { ...v, from: value ? 'current' : undefined };
    default:
      return v;
  }
}

export interface VoicePanelProps {
  voice: Voice;
  comp: Composition;
  /** Under a span, which places it: no start of its own, and hints for the span's fit. */
  spanned: boolean;
  onJoin(owner: string | null): void;
  errors: FieldError[];
  faults: Faults | undefined;
  onChange(v: Voice): void;
  onDelete(): void;
}

export function VoicePanel(p: VoicePanelProps) {
  const { voice: v, errors, faults, onChange, onDelete, spanned } = p;
  const mine = errors.filter((e) => e.voice === v.id);
  const errorOf = (field: string) => mine.find((e) => e.field === field)?.error ?? null;
  const loose = mine.filter((e) => LOOSE.has(e.field));
  const config = {
    name: v.name,
    start: v.start,
    rate: v.rate,
    repeat: v.loop === true,
    passes: typeof v.loop === 'number' ? v.loop : 1,
    fadeIn: v.fade.in ?? 0,
    fadeOut: v.fade.out ?? 0,
    freeze: v.freeze ?? 'none',
    locus: v.locus ?? '',
    fromCurrent: v.from === 'current',
  };
  return (
    <section className={s.panel} aria-label={`voice ${v.name}`}>
      <ControlPanel
        title={`voice · ${v.name}`}
        schema={spanned ? SPAN_SCHEMA : SCHEMA}
        config={config}
        setConfig={(path, value) => onChange(written(v, path, value))}
      />
      {spanned && (
        <label className={s.row} title={docOf('VoiceSpec.start')}>
          start
          <input type="number" className={s.number} value={v.start} disabled readOnly />
          <span className={s.note}>a span places it</span>
        </label>
      )}
      <OwnerField
        comp={p.comp}
        id={v.id}
        doc={docOf('VoiceSpec.owner')}
        error={errorOf('owner')}
        onChange={p.onJoin}
      />
      {spanned && (
        <HintsFields hints={v.hints} onChange={(h) => onChange(withKey(v, 'hints', h))} />
      )}
      <div title={docOf('VoiceSpec.fade')}>
        <EaseField
          label="fade ease"
          value={v.fade.ease}
          onChange={(ease) => onChange({ ...v, fade: withKey(v.fade, 'ease', ease) })}
        />
      </div>
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
      <div title={docOf('VoiceSpec.stagger')}>
        <ExprInput
          label="stagger"
          placeholder="(s) => s.col * 80"
          value={v.stagger?.code ?? ''}
          error={errorOf('stagger')}
          onCommit={(code) => onChange({ ...v, stagger: code ? { code } : undefined })}
        />
      </div>
      <div title={docOf('VoiceSpec.target')}>
        <ExprInput
          label="target"
          placeholder="(s) => s.row === 0"
          value={v.target?.code ?? ''}
          error={errorOf('target')}
          onCommit={(code) => onChange({ ...v, target: code ? { code } : undefined })}
        />
      </div>
      <div title={docOf('VoiceSpec.weight')}>
        <WeightField
          value={v.weight}
          error={errorOf('weight')}
          onChange={(weight) => onChange({ ...v, weight })}
        />
      </div>
      {faults && faults.count > 0 && (
        <p className={s.fault} role="status">
          {faults.count} calls threw; first: {faults.first}
        </p>
      )}
      <p className={s.row} title={docOf('VoiceSpec.anchor')}>
        anchor: {v.anchor ? JSON.stringify(v.anchor) : 'none'}
        {spanned && <span className={s.note}>its start: a span places it</span>}
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
