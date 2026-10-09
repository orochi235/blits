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
import s from './App.module.css';
import r from './RulesPanel.module.css';

type NumberChannel = Exclude<keyof Rules, 'color'>;

const NUMBER_RULES: readonly NumberRule[] = ['sum', 'mul', 'max', 'last'];

function BoundsFields({
  ch,
  spec,
  onChange,
}: {
  ch: string;
  spec: NumberRuleSpec;
  onChange(b: [number, number] | undefined): void;
}) {
  const [lo, hi] = spec.bounds ?? [Number.NaN, Number.NaN];
  const edit = (i: 0 | 1, n: number) => {
    const next: [number, number] = [i === 0 ? n : lo, i === 1 ? n : hi];
    if (next.some(Number.isNaN)) onChange(undefined);
    else if (next[0] < next[1]) onChange(next);
  };
  const field = (i: 0 | 1, value: number) => (
    <input
      type="number"
      step="any"
      className={r.bound}
      aria-label={`${ch} ${i === 0 ? 'lower' : 'upper'} bound`}
      placeholder={i === 0 ? 'min' : 'max'}
      value={Number.isNaN(value) ? '' : value}
      onChange={(e) => edit(i, e.target.value === '' ? Number.NaN : e.target.valueAsNumber)}
    />
  );
  return (
    <>
      {field(0, lo)}
      {field(1, hi)}
    </>
  );
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
    const same = JSON.stringify(spec) === JSON.stringify(DEFAULT_RULES[ch]);
    const next = withKey(comp.rules ?? {}, ch, same ? undefined : spec);
    onChange(withKey(comp, 'rules', Object.keys(next).length > 0 ? next : undefined));
  };
  const numberRow = (ch: NumberChannel) => {
    const spec = rules[ch];
    const options = ch === 'offset' ? NUMBER_RULES.filter((r) => r !== 'last') : NUMBER_RULES;
    return (
      <>
        <select
          aria-label={`${ch} rule`}
          value={spec.rule}
          onChange={(e) => {
            const rule = e.target.value as NumberRule;
            set(ch, rule === 'last' ? { rule } : ({ ...spec, rule } as Rules[typeof ch]));
          }}
        >
          {options.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {spec.rule !== 'last' && (
          <BoundsFields
            ch={ch}
            spec={spec}
            onChange={(b) => set(ch, withKey(spec, 'bounds', b) as Rules[typeof ch])}
          />
        )}
      </>
    );
  };
  const colorRow = (spec: ColorRuleSpec) => (
    <>
      <select
        aria-label="color rule"
        value={spec.rule}
        onChange={(e) => set('color', { ...spec, rule: e.target.value as ColorRuleSpec['rule'] })}
      >
        <option value="replace">replace</option>
        <option value="average">average</option>
      </select>
      <select
        aria-label="color lerp"
        value={spec.lerp}
        onChange={(e) => set('color', { ...spec, lerp: e.target.value as ColorRuleSpec['lerp'] })}
      >
        <option value="oklch">oklch</option>
        <option value="oklab">oklab</option>
      </select>
    </>
  );
  return (
    <fieldset className={s.panel} aria-label="fold rules">
      <legend>fold rules</legend>
      {CHANNELS.map((ch) => (
        <div key={ch} className={s.row}>
          <span>{ch}</span>
          {ch === 'color' ? colorRow(rules.color) : numberRow(ch)}
          <output className={s.readout}>{kit[ch].kind ?? 'custom'}</output>
        </div>
      ))}
      {comp.rules && (
        <button type="button" onClick={() => onChange(withKey(comp, 'rules', undefined))}>
          default rules
        </button>
      )}
    </fieldset>
  );
}
