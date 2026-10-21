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
import { useMemo, useRef } from 'react';
import s from './App.module.css';
import r from './Rows.module.css';

export interface FieldExtras {
  /** The accessible name, where the label alone does not say which field this is. */
  name?: string;
  layout?: 'block' | 'inline';
  span?: boolean;
}

/** A typed schema leaf drawn as a property field, with the row props a leaf has no word for. */
export function fieldRow(extra: FieldExtras): ControlRenderer {
  return (ctx) => {
    const leaf = ctx.pref as unknown as Record<string, unknown>;
    const row = {
      label: ctx.pref.name,
      description: ctx.pref.description || undefined,
      disabled: ctx.disabled,
      placeholder: leaf.placeholder as string | undefined,
      ...extra,
    };
    return ctx.pref.kind === 'number' ? (
      <PropertyField
        {...row}
        kind="number"
        value={ctx.value as number}
        unit={leaf.suffix as string | undefined}
        step={leaf.step as number | undefined}
        onChange={ctx.setValue}
      />
    ) : (
      <PropertyField
        {...row}
        kind="string"
        controlClassName={extra.span ? r.fill : undefined}
        value={String(ctx.value)}
        maxLength={leaf.maxLength as number | undefined}
        onChange={ctx.setValue}
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
          <PropertyField
            layout="inline"
            label="cols"
            name="columns"
            kind="number"
            value={stage.cols}
            onChange={(n: number) => set(sizeDots(stage, n, stage.rows))}
          />
          <PropertyField
            layout="inline"
            label="rows"
            kind="number"
            value={stage.rows}
            onChange={(n: number) => set(sizeDots(stage, stage.cols, n))}
          />
        </>
      ) : (
        <PropertyField
          layout="inline"
          label="text"
          name="stage text"
          kind="string"
          value={stage.text}
          maxLength={MAX_TEXT}
          onChange={(t: string) => set(lettersOf(t))}
        />
      )}
    </div>
  );
}

/** Title and length, for the header. */
export function CompFields({ comp, onChange }: CompProps) {
  return (
    <div className={r.bar}>
      <PropertyField
        layout="inline"
        label="title"
        kind="string"
        value={comp.title}
        onChange={(title: string) => onChange({ ...comp, title })}
      />
      <PropertyField
        layout="inline"
        label="length"
        name="length in ms"
        kind="number"
        unit="ms"
        step={100}
        value={comp.length}
        onChange={(n: number) => onChange(withLength(comp, n))}
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
          .render(fieldRow({ span: true, name: `level ${name} name` })),
        min: f
          .number(0)
          .label('min')
          .render(fieldRow({ name: `level ${name} min` })),
        max: f
          .number(1)
          .label('max')
          .render(fieldRow({ name: `level ${name} max` })),
        value: f
          .number(0)
          .label('value')
          .render(fieldRow({ name: `level ${name} value` })),
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
