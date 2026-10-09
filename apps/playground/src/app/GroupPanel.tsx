import type { FitResult } from '@msb235/blits';
import type { Composition, Group } from '@pg/blits/composition';
import { fitFaultKey } from '@pg/blits/cueGroups';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ControlPanel } from '@weasel-js/labkit';
import s from './App.module.css';
import { docOf } from './docs';
import { HintsFields } from './HintsFields';
import { OwnerField } from './OwnerField';
import { SpanFields } from './SpanFields';
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

const SECTIONS = [
  { label: 'timing', paths: ['start', 'rate'] },
  { label: 'fade', paths: ['fadeIn', 'fadeOut'] },
  { label: 'blending', paths: ['freeze'] },
];
const FIELDS = Object.values(SHARED);
const specOf = (kind: Group['kind']) => (kind === 'span' ? 'SpanSpec' : 'OwnerSpec');
const docFor = (kind: Group['kind']) => (key: string) => docOf(`${specOf(kind)}.${memberOf(key)}`);
const schemas = new Map<string, ReturnType<typeof schemaOf>>();
/** Under a span, which places it, a group has no start of its own. */
function schemaFor(kind: Group['kind'], spanned: boolean) {
  const key = `${kind} ${spanned}`;
  let schema = schemas.get(key);
  if (!schema) {
    const fields = spanned ? FIELDS.filter((f) => f.key !== 'start') : FIELDS;
    schema = schemaOf(fields, docFor(kind), SECTIONS);
    schemas.set(key, schema);
  }
  return schema;
}

/** Errors on fields this panel has no input for, shown in a list of their own. */
const LOOSE = new Set(['name', 'cue', 'start', 'anchor']);

export interface GroupPanelProps {
  group: Group;
  comp: Composition;
  /** Under a span, which places it: no start or anchor of its own, and hints for the span's fit. */
  spanned: boolean;
  errors: FieldError[];
  /** Faults by voice or group id, and by `fitFaultKey` for each code fit step. */
  faultsOf(key: string): Faults | undefined;
  /** For a running span, how it last fitted its children. */
  result: FitResult | undefined;
  onChange(g: Group): void;
  onJoin(owner: string | null): void;
  onDelete(): void;
}

export function GroupPanel(p: GroupPanelProps) {
  const { group: g, spanned, onChange } = p;
  const mine = p.errors.filter((e) => e.voice === g.id);
  const errorOf = (field: string) => mine.find((e) => e.field === field) ?? null;
  const doc = docFor(g.kind);
  const holdsOwner = p.comp.groups?.some((x) => x.owner === g.id && x.kind === 'owner') ?? false;
  return (
    <section className={s.panel} aria-label={`group ${g.name}`}>
      <ControlPanel
        title={`${g.kind} · ${g.name}`}
        schema={schemaFor(g.kind, spanned)}
        config={sharedConfig(g)}
        setConfig={(path, value) => onChange(writtenShared(g, path, value) ?? g)}
      />
      <label className={s.row}>
        kind
        <select
          value={g.kind}
          onChange={(e) => onChange({ ...g, kind: e.target.value as Group['kind'] })}
        >
          <option
            value="owner"
            disabled={spanned}
            title={spanned ? 'a span holds only spans and voices' : undefined}
          >
            owner
          </option>
          <option
            value="span"
            disabled={holdsOwner}
            title={holdsOwner ? 'a span cannot hold an owner' : undefined}
          >
            span
          </option>
        </select>
      </label>
      <OwnerField
        comp={p.comp}
        id={g.id}
        doc={doc('owner')}
        error={errorOf('owner')?.error ?? null}
        onChange={p.onJoin}
      />
      {spanned && (
        <HintsFields hints={g.hints} onChange={(h) => onChange(withKey(g, 'hints', h))} />
      )}
      <FadeEase x={g} doc={doc('fade')} onChange={onChange} />
      <LooseErrors errors={mine.filter((e) => LOOSE.has(e.field))} label="group errors" />
      <div title={doc('weight')}>
        <WeightField
          value={g.weight}
          error={errorOf('weight')?.error ?? null}
          onChange={(weight) => onChange({ ...g, weight })}
        />
      </div>
      <FaultLine faults={p.faultsOf(g.id)} />
      {!spanned && <AnchorRow x={g} doc={doc('anchor')} spanned={false} onChange={onChange} />}
      {g.kind === 'span' && (
        <SpanFields
          span={g.span ?? {}}
          onChange={(span) => onChange({ ...g, span })}
          errorOf={errorOf}
          faultsOf={(i) => p.faultsOf(fitFaultKey(g.id, i))}
          result={p.result}
        />
      )}
      <button type="button" onClick={p.onDelete}>
        delete group
      </button>
    </section>
  );
}
