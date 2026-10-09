import type { Composition, Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ExprInput } from '@pg/widgets/ExprInput';
import { type ConfigField, ControlPanel } from '@weasel-js/labkit';
import s from './App.module.css';
import { docOf } from './docs';
import { HintsFields } from './HintsFields';
import { OwnerField } from './OwnerField';
import {
  AnchorRow,
  FadeEase,
  FaultLine,
  LooseErrors,
  memberOf,
  SHARED,
  schemaOf,
  sharedConfig,
  writtenShared,
} from './SpecFields';
import { WeightField } from './WeightField';

const FIELDS: ConfigField[] = [
  SHARED.name,
  SHARED.start,
  SHARED.rate,
  { key: 'repeat', label: 'repeat', type: 'checkbox', default: true },
  { key: 'passes', label: 'passes', type: 'number', default: 1, min: 1, step: 1 },
  SHARED.fadeIn,
  SHARED.fadeOut,
  SHARED.freeze,
  { key: 'locus', label: 'locus', type: 'text', default: '' },
  { key: 'fromCurrent', label: "from: 'current'", type: 'checkbox', default: false },
];
/** The `VoiceSpec` member each row of its own writes, whose doc comment it shows. */
const SPEC_KEY: Record<string, string> = { repeat: 'loop', passes: 'loop', fromCurrent: 'from' };
const doc = (key: string) => docOf(`VoiceSpec.${SPEC_KEY[key] ?? memberOf(key)}`);
const SECTIONS = [
  { label: 'timing', paths: ['start', 'rate', 'repeat', 'passes'] },
  { label: 'fade', paths: ['fadeIn', 'fadeOut'] },
  { label: 'blending', paths: ['freeze', 'locus', 'fromCurrent'] },
];
const SCHEMA = schemaOf(FIELDS, doc, SECTIONS);
/** Under a span, `start` is drawn on its own, disabled, since the span places the voice. */
const SPAN_SCHEMA = schemaOf(
  FIELDS.filter((f) => f.key !== 'start'),
  doc,
  SECTIONS,
);

/** Errors on fields this panel has no input for, shown in a list of their own. */
const LOOSE = new Set(['name', 'cue', 'start', 'anchor', 'loop']);

/** One edited row of the control panel, written back into the voice it came from. */
function written(v: Voice, path: string, value: unknown): Voice {
  const shared = writtenShared(v, path, value);
  if (shared) return shared;
  switch (path) {
    case 'locus':
      return withKey(v, 'locus', (value as string) || undefined);
    case 'repeat':
      return { ...v, loop: value ? true : typeof v.loop === 'number' ? v.loop : 1 };
    case 'passes':
      return Number.isFinite(value) ? { ...v, loop: Math.max(1, Math.round(value as number)) } : v;
    case 'fromCurrent':
      return withKey(v, 'from', value ? ('current' as const) : undefined);
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
  const config = {
    ...sharedConfig(v),
    repeat: v.loop === true,
    passes: typeof v.loop === 'number' ? v.loop : 1,
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
      <FadeEase x={v} doc={docOf('VoiceSpec.fade')} onChange={onChange} />
      <LooseErrors errors={mine.filter((e) => LOOSE.has(e.field))} label="voice errors" />
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
      <FaultLine faults={faults} />
      <AnchorRow x={v} doc={docOf('VoiceSpec.anchor')} spanned={spanned} onChange={onChange} />
      <button type="button" onClick={onDelete}>
        delete voice
      </button>
    </section>
  );
}
