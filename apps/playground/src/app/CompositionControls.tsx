import { type Composition, type Level, MAX_LEVELS, MAX_TEXT } from '@pg/blits/composition';
import {
  addLevel,
  lettersOf,
  removeLevel,
  renameLevel,
  sizeDots,
  switchStage,
  tuneLevel,
  withLength,
} from '@pg/blits/edit';
import {
  type ConfigEntry,
  ControlPanel,
  type ControlRenderer,
  f,
  resolveConfigSchema,
} from '@weasel-js/labkit';
import { PrefActionButton, PropertyField, PropertyRow } from '@weasel-js/ui';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import s from './App.module.css';
import r from './Rows.module.css';

const ignore = () => {};

export interface DraftRowProps {
  label: ReactNode;
  /** The accessible name, where `label` is not plain text. */
  name?: string;
  description?: string;
  kind: 'number' | 'string';
  value: string | number;
  onCommit(next: string | number): void;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
  step?: number;
  disabled?: boolean;
  span?: boolean;
  layout?: 'block' | 'inline';
}

/**
 * A property row that commits on Enter or blur, so typing makes one undo step, not one per key, and
 * Escape puts back what it held. A blank number field puts its value back too.
 */
export function DraftRow(p: DraftRowProps) {
  // Remounting the field is the only way to drop the text field's draft, which it keeps to itself.
  const [nonce, setNonce] = useState(0);
  const tag = `pg-draft-${useId().replace(/[^a-z0-9]/gi, '')}`;
  useEffect(() => {
    const row = document.querySelector(`.${tag}`);
    if (!row) return;
    if (nonce > 0) row.querySelector('input')?.focus();
    const key = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') setNonce((n) => n + 1);
    };
    row.addEventListener('keydown', key, true);
    return () => row.removeEventListener('keydown', key, true);
  }, [tag, nonce]);
  const row = {
    label: p.label,
    name: p.name,
    description: p.description,
    disabled: p.disabled,
    span: p.span,
    controlClassName: p.span && p.kind === 'string' ? r.fill : undefined,
    layout: p.layout,
    rowClassName: tag,
    placeholder: p.placeholder,
    onInput: ignore,
  };
  return p.kind === 'number' ? (
    <PropertyField
      key={nonce}
      {...row}
      kind="number"
      value={typeof p.value === 'number' ? p.value : Number.NaN}
      unit={p.unit}
      step={p.step}
      onChange={(n: number) => p.onCommit(n)}
    />
  ) : (
    <PropertyField
      key={nonce}
      {...row}
      kind="string"
      value={String(p.value)}
      maxLength={p.maxLength}
      onChange={(t: string) => p.onCommit(t)}
    />
  );
}

/** A schema leaf drawn as a {@link DraftRow}, from the leaf's own label, description and extras. */
export function drafted(extra: Partial<DraftRowProps> = {}): ControlRenderer {
  return (ctx) => {
    const leaf = ctx.pref as unknown as Record<string, unknown>;
    return (
      <DraftRow
        label={ctx.pref.name}
        description={ctx.pref.description || undefined}
        kind={ctx.pref.kind === 'number' ? 'number' : 'string'}
        value={ctx.value as string | number}
        onCommit={ctx.setValue}
        placeholder={leaf.placeholder as string | undefined}
        maxLength={leaf.maxLength as number | undefined}
        unit={leaf.suffix as string | undefined}
        step={leaf.step as number | undefined}
        disabled={ctx.disabled}
        {...extra}
      />
    );
  };
}

/** An action's button on a row of its own, unlabeled: labkit's action row repeats the button's text as its label. */
export const actionRow: ControlRenderer = (ctx) => (
  <PropertyRow group span layout="inline" label="">
    <PrefActionButton
      pref={ctx.pref as Parameters<typeof PrefActionButton>[0]['pref']}
      path={ctx.path}
      disabled={ctx.disabled}
    />
  </PropertyRow>
);

/** The latest `value`, for a callback a memoized schema holds. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface CompProps {
  comp: Composition;
  onChange(next: Composition): void;
}

// A ControlPanel's `as('bar')` group draws a field that commits on Enter as a whole stacked row, so the
// header's and the stage's few fields are drawn as the same property rows, side by side.
export function StageControls({ comp, onChange }: CompProps) {
  const { stage } = comp;
  const set = (next: Composition['stage']) => onChange({ ...comp, stage: next });
  return (
    <div className={r.bar}>
      <PropertyField
        hug
        layout="inline"
        label="stage"
        name="stage kind"
        kind="enum"
        control="toggle"
        value={stage.kind}
        options={[
          { value: 'dots', label: 'dots' },
          { value: 'letters', label: 'letters' },
        ]}
        onChange={(k: string) => set(switchStage(stage, k as Composition['stage']['kind']))}
      />
      {stage.kind === 'dots' ? (
        <>
          <DraftRow
            layout="inline"
            label="cols"
            name="columns"
            kind="number"
            value={stage.cols}
            onCommit={(n) => set(sizeDots(stage, n as number, stage.rows))}
          />
          <DraftRow
            layout="inline"
            label="rows"
            kind="number"
            value={stage.rows}
            onCommit={(n) => set(sizeDots(stage, stage.cols, n as number))}
          />
        </>
      ) : (
        <DraftRow
          layout="inline"
          label="text"
          name="stage text"
          kind="string"
          value={stage.text}
          maxLength={MAX_TEXT}
          onCommit={(t) => set(lettersOf(String(t)))}
        />
      )}
    </div>
  );
}

/** Title and length, for the header. */
export function CompFields({ comp, onChange }: CompProps) {
  return (
    <div className={r.bar}>
      <DraftRow
        layout="inline"
        label="title"
        kind="string"
        value={comp.title}
        onCommit={(title) => onChange({ ...comp, title: String(title) })}
      />
      <DraftRow
        layout="inline"
        label="length"
        name="length in ms"
        kind="number"
        unit="ms"
        step={100}
        value={comp.length}
        onCommit={(n) => onChange(withLength(comp, n as number))}
      />
    </div>
  );
}

const levelKey = (i: number) => `level${i}`;

function levelsSchema(names: readonly string[], act: { current: (i: number | null) => void }) {
  const shape: Record<string, ConfigEntry> = {};
  names.forEach((name, i) => {
    shape[levelKey(i)] = f
      .group({
        name: f
          .string('')
          .label('name')
          .render(drafted({ span: true, name: `level ${name} name` })),
        min: f
          .number(0)
          .label('min')
          .render(drafted({ name: `level ${name} min` })),
        max: f
          .number(1)
          .label('max')
          .render(drafted({ name: `level ${name} max` })),
        value: f
          .number(0)
          .label('value')
          .render(drafted({ name: `level ${name} value` })),
        remove: f
          .action(() => act.current(i))
          .label(`remove level ${name}`)
          .render(actionRow),
      })
      .label(name);
  });
  shape.add = f
    .action(() => act.current(null))
    .label('add level')
    .render(actionRow)
    .enableIf((c) => c.full !== true);
  return resolveConfigSchema(f.schema(shape));
}

export function LevelsPanel({ comp, onChange }: CompProps) {
  const set = (levels: Level[]) => onChange({ ...comp, levels });
  const levels = comp.levels;
  // Removing or adding is an action, which a memoized schema calls through this.
  const act = useLatest((i: number | null) =>
    set(i === null ? addLevel(levels) : removeLevel(levels, i)),
  );
  const names = levels.map((l) => l.name);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt when a name or the count changes
  const schema = useMemo(() => levelsSchema(names, act), [names.join('\n')]);
  const config: Record<string, unknown> = { full: levels.length >= MAX_LEVELS };
  levels.forEach((l, i) => {
    config[levelKey(i)] = { name: l.name, value: l.value, min: l.min, max: l.max };
  });
  const write = (path: string, value: unknown) => {
    const [key, field] = path.split('.');
    const i = Number(key?.slice('level'.length));
    if (field === 'name') set(renameLevel(levels, i, String(value)));
    else if (field === 'value' || field === 'min' || field === 'max')
      set(tuneLevel(levels, i, { [field]: value as number }));
  };
  return (
    <section className={s.panel} aria-label="levels">
      <ControlPanel title="levels" collapsible schema={schema} config={config} setConfig={write} />
    </section>
  );
}
