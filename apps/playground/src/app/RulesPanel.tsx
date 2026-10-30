import type { Composition } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import {
  CHANNELS,
  type ColorRuleSpec,
  DEFAULT_RULES,
  kitOf,
  type NumberRule,
  type NumberRuleSpec,
  type Rules,
} from '@pg/blits/kit';
import { scopedIcon } from '@weasel-js/icons';
import {
  type ConfigEntry,
  ControlPanel,
  type ControlRenderer,
  f,
  resolveConfigSchema,
} from '@weasel-js/labkit';
import { Button, Icon, PropertyControl, PropertyRow } from '@weasel-js/ui';
import { useMemo } from 'react';
import s from './App.module.css';
import { actionRow, useLatest } from './CompositionControls';
import r from './Rows.module.css';

const icon = scopedIcon('ui');

type NumberChannel = Exclude<keyof Rules, 'color'>;

const NUMBER_RULES: readonly NumberRule[] = ['sum', 'mul', 'max', 'last'];
const ignore = () => {};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const bandOf = (ch: string) => `${ch}Bounds`;
const label = (spec: Rules[keyof Rules]) =>
  'type' in spec
    ? `${spec.rule}, ${spec.type}`
    : spec.bounds
      ? `${spec.rule} [${spec.bounds.join(', ')}]`
      : spec.rule;

/** A row per channel, whose renderer draws it, a bounds row under each bounded one, and a reset for all. */
function rulesSchema(reset: { current: () => void }) {
  const shape: Record<string, ConfigEntry> = {};
  for (const ch of CHANNELS) {
    shape[ch] = f.custom('rule', null).label(ch);
    if (ch !== 'color')
      shape[bandOf(ch)] = f
        .custom('bounds', null)
        .label('bounds')
        .showIf((c) => c[bandOf(ch)] === true);
  }
  shape.reset = f
    .action(() => reset.current())
    .label("all to blits' defaults")
    .render(actionRow)
    .enableIf((c) => c.changed === true);
  return resolveConfigSchema(f.schema(shape));
}

/** Each channel's fold rule, which the composition's kit is made from. */
export function RulesPanel({
  comp,
  onChange,
}: {
  comp: Composition;
  onChange(c: Composition): void;
}) {
  const rules = { ...DEFAULT_RULES, ...comp.rules };
  const kit = kitOf(comp.rules);
  const set = <K extends keyof Rules>(ch: K, spec: Rules[K]) => {
    const next = withKey(comp.rules ?? {}, ch, same(spec, DEFAULT_RULES[ch]) ? undefined : spec);
    onChange(withKey(comp, 'rules', Object.keys(next).length > 0 ? next : undefined));
  };
  const reset = useLatest(() => onChange(withKey(comp, 'rules', undefined)));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is read through its ref
  const schema = useMemo(() => rulesSchema(reset), []);
  const config: Record<string, unknown> = { changed: comp.rules !== undefined };
  for (const ch of CHANNELS) {
    const spec = rules[ch];
    if (!('type' in spec)) config[bandOf(ch)] = spec.rule !== 'last' && spec.bounds !== undefined;
  }

  const select = (
    name: string,
    value: string,
    options: readonly string[],
    to: (v: string) => void,
  ) => (
    <PropertyControl
      kind="enum"
      className={r.select}
      name={name}
      value={value}
      options={options.map((o) => ({ value: o, label: o }))}
      onChange={to}
    />
  );
  const back = (ch: keyof Rules) => (
    <span className={same(rules[ch], DEFAULT_RULES[ch]) ? r.idle : undefined}>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        ariaLabel={`default ${ch} rule`}
        tooltip={`back to blits' default: ${label(DEFAULT_RULES[ch])}`}
        onClick={() => set(ch, DEFAULT_RULES[ch])}
      >
        <Icon name={icon('ui:reset')} />
      </Button>
    </span>
  );

  const numberRow =
    (ch: NumberChannel): ControlRenderer =>
    () => {
      const spec = rules[ch];
      const options = ch === 'offset' ? NUMBER_RULES.filter((x) => x !== 'last') : NUMBER_RULES;
      const kind = kit[ch].kind ?? 'custom';
      return (
        <PropertyRow
          group
          layout="inline"
          label={ch}
          changed={!same(spec, DEFAULT_RULES[ch])}
          // The kind only says more than the rule where the channel is not one plain number.
          hint={kind !== spec.rule && !spec.bounds ? kind : undefined}
        >
          <span className={r.controls}>
            {select(`${ch} rule`, spec.rule, options, (v) => {
              const rule = v as NumberRule;
              set(ch, rule === 'last' ? { rule } : ({ ...spec, rule } as Rules[typeof ch]));
            })}
            {spec.rule !== 'last' && (
              <PropertyControl
                kind="boolean"
                control="toggle"
                name="bounds"
                value={spec.bounds !== undefined}
                onChange={(on: boolean) =>
                  set(
                    ch,
                    withKey(
                      spec,
                      'bounds',
                      on ? (DEFAULT_RULES[ch].bounds ?? [0, 1]) : undefined,
                    ) as Rules[typeof ch],
                  )
                }
              />
            )}
            {back(ch)}
          </span>
        </PropertyRow>
      );
    };

  const boundsRow =
    (ch: NumberChannel): ControlRenderer =>
    () => {
      const spec: NumberRuleSpec = rules[ch];
      const [lo, hi] = spec.bounds ?? [0, 1];
      // Bounds that would cross are refused, and the field shows what it held.
      const edit = (i: 0 | 1) => (n: number) => {
        const next: [number, number] = i === 0 ? [n, hi] : [lo, n];
        if (next[0] < next[1]) set(ch, { ...spec, bounds: next } as Rules[typeof ch]);
      };
      const field = (i: 0 | 1) => (
        <PropertyControl
          kind="number"
          name={`${ch} ${i === 0 ? 'lower' : 'upper'} bound`}
          className={r.bound}
          value={i === 0 ? lo : hi}
          step={0.1}
          onInput={ignore}
          onChange={edit(i)}
        />
      );
      return (
        <PropertyRow group layout="inline" label={`${ch} bounds`}>
          <span className={r.controls}>
            {field(0)}
            <span className={r.to}>to</span>
            {field(1)}
          </span>
        </PropertyRow>
      );
    };

  const colorRow: ControlRenderer = () => {
    const spec: ColorRuleSpec = rules.color;
    return (
      <PropertyRow group layout="inline" label="color" changed={!same(spec, DEFAULT_RULES.color)}>
        <span className={r.controls}>
          {select('color rule', spec.rule, ['replace', 'average'], (v) =>
            set('color', { ...spec, rule: v as ColorRuleSpec['rule'] }),
          )}
          <span className={r.to}>as</span>
          {select('color type', spec.type, ['color', 'ink'], (v) =>
            set('color', { ...spec, type: v as ColorRuleSpec['type'] }),
          )}
          {back('color')}
        </span>
      </PropertyRow>
    );
  };

  const renderers: Record<string, ControlRenderer> = { color: colorRow };
  for (const ch of CHANNELS) {
    if (ch === 'color') continue;
    renderers[ch] = numberRow(ch);
    renderers[bandOf(ch)] = boundsRow(ch);
  }
  return (
    <section className={s.panel} aria-label="fold rules">
      <ControlPanel
        title="fold rules"
        collapsible
        pack="one-up"
        layout="inline"
        schema={schema}
        config={config}
        setConfig={ignore}
        renderers={renderers}
      />
    </section>
  );
}
