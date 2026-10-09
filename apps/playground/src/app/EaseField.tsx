import type { Easing } from '@msb235/blits';
import { toBlits, toWeasel } from '@pg/blits/easing';
import { EasingPicker } from '@weasel-js/ui';
import s from './App.module.css';

type Steps = { steps: number; jump?: 'start' | 'end' };

const isSteps = (e: Easing | undefined): e is Steps =>
  typeof e === 'object' && e !== null && 'steps' in e;

export interface EaseFieldProps {
  label: string;
  /** Undefined leaves blits' default for the field. */
  value: Easing | undefined;
  onChange(e: Easing | undefined): void;
  /** What an unset value follows instead, offered as a box to tick rather than shown as linear. */
  inherit?: string;
}

/** Any blits ease as data: a curve through weasel's picker, or a count of steps. */
export function EaseField({ label, value, onChange, inherit }: EaseFieldProps) {
  const steps = isSteps(value) ? value : undefined;
  if (inherit !== undefined && value === undefined)
    return (
      <label className={s.row}>
        <input type="checkbox" checked onChange={() => onChange('linear')} />
        {label}: same as {inherit}
      </label>
    );
  return (
    <fieldset className={s.field}>
      <legend>{label}</legend>
      {inherit !== undefined && (
        <label className={s.row}>
          <input type="checkbox" checked={false} onChange={() => onChange(undefined)} />
          same as {inherit}
        </label>
      )}
      <label className={s.row}>
        <input
          type="checkbox"
          checked={steps !== undefined}
          onChange={(e) => onChange(e.target.checked ? { steps: 4, jump: 'end' } : undefined)}
        />
        steps
      </label>
      {steps ? (
        <div className={s.row}>
          <input
            type="number"
            min={1}
            step={1}
            aria-label={`${label} steps`}
            value={steps.steps}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isInteger(n) && n > 0) onChange({ ...steps, steps: n });
            }}
          />
          <select
            aria-label={`${label} jump`}
            value={steps.jump ?? 'end'}
            onChange={(e) => onChange({ ...steps, jump: e.target.value as 'start' | 'end' })}
          >
            <option value="end">jump at end</option>
            <option value="start">jump at start</option>
          </select>
        </div>
      ) : (
        <EasingPicker
          value={toWeasel(value)}
          onChange={(next) => {
            const e = toBlits(next);
            // null: a curve with no bezier form, which blits cannot hold as data.
            if (e !== null) onChange(e);
          }}
        />
      )}
    </fieldset>
  );
}
