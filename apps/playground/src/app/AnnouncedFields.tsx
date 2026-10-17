import { type Announced, type Composition, MAX_ANNOUNCED } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import {
  type ConfigEntry,
  ControlPanel,
  type ControlRenderer,
  f,
  resolveConfigSchema,
} from '@weasel-js/labkit';
import { Button, PropertyControl, PropertyRow } from '@weasel-js/ui';
import { useMemo } from 'react';
import s from './App.module.css';
import { actionRow, useLatest } from './CompositionControls';
import { docOf } from './docs';
import r from './Rows.module.css';

const ignore = () => {};

function freshName(list: readonly Announced[]): string {
  const names = new Set(list.map((a) => a.name));
  if (!names.has('beat')) return 'beat';
  let n = 2;
  while (names.has(`beat ${n}`)) n++;
  return `beat ${n}`;
}

const markKey = (i: number) => `mark${i}`;

function marksSchema(count: number, add: { current: () => void }) {
  const shape: Record<string, ConfigEntry> = {};
  for (let i = 0; i < count; i++) shape[markKey(i)] = f.custom('mark', null).label(`mark ${i + 1}`);
  shape.add = f
    .action(() => add.current())
    .label('add mark')
    .render(actionRow)
    .enableIf((c) => c.full !== true);
  shape.note = f.label('a voice anchored {"start": {"with": "beat"}} waits for it');
  return resolveConfigSchema(f.schema(shape));
}

/** The marks the composition announces: each a name an anchor can target, at a time on its clock. */
export function AnnouncedFields({
  comp,
  onChange,
}: {
  comp: Composition;
  onChange(c: Composition): void;
}) {
  const list = comp.announced ?? [];
  const set = (next: Announced[]) =>
    onChange(withKey(comp, 'announced', next.length > 0 ? next : undefined));
  const tune = (i: number, change: Partial<Announced>) =>
    set(list.map((a, k) => (k === i ? { ...a, ...change } : a)));
  const add = useLatest(() => set([...list, { name: freshName(list), at: 1000 }]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: adding is read through its ref
  const schema = useMemo(() => marksSchema(list.length, add), [list.length]);

  const row =
    (i: number): ControlRenderer =>
    () => {
      const a = list[i];
      if (!a) return null;
      return (
        <PropertyRow
          group
          layout="inline"
          label={`mark ${i + 1}`}
          description={docOf('Mix.announce')}
        >
          <span className={r.controls}>
            <PropertyControl
              kind="string"
              name={`mark ${i + 1} name`}
              value={a.name}
              onInput={ignore}
              onChange={(name: string) => tune(i, { name })}
            />
            <span className={r.to}>at</span>
            <PropertyControl
              kind="number"
              name={`mark ${i + 1} at`}
              className={r.at}
              value={a.at}
              step={10}
              unit="ms"
              onInput={ignore}
              onChange={(at: number) => tune(i, { at })}
            />
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              ariaLabel={`remove mark ${i + 1}`}
              onClick={() => set(list.filter((_, k) => k !== i))}
            >
              ×
            </Button>
          </span>
        </PropertyRow>
      );
    };
  const renderers: Record<string, ControlRenderer> = {};
  list.forEach((_, i) => {
    renderers[markKey(i)] = row(i);
  });
  return (
    <section className={s.panel} aria-label="announced marks">
      <ControlPanel
        title={<span title={docOf('Mix.announce')}>announced marks</span>}
        pack="one-up"
        layout="inline"
        schema={schema}
        config={{ full: list.length >= MAX_ANNOUNCED }}
        setConfig={ignore}
        renderers={renderers}
      />
    </section>
  );
}
