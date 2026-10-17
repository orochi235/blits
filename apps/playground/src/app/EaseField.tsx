import type { Easing } from '@msb235/blits';
import { toBlits, toWeasel } from '@pg/blits/easing';
import { EasingPicker, PropertyControl, PropertyRow } from '@weasel-js/ui';
import m from './PatchLive.module.css';

type Steps = { steps: number; jump?: 'start' | 'end' };
type Jump = NonNullable<Steps['jump']>;

const JUMPS: { value: Jump; label: string }[] = [
  { value: 'end', label: 'jump at end' },
  { value: 'start', label: 'jump at start' },
];

const isSteps = (e: Easing | undefined): e is Steps =>
  typeof e === 'object' && e !== null && 'steps' in e;

/** A blits ease in a word or two, for a cell too small for the curve. */
export function easeName(e: Easing | undefined): string {
  if (e === undefined) return 'linear';
  if (typeof e === 'string') return e;
  if (typeof e === 'function') return 'function';
  return isSteps(e) ? `${e.steps} steps` : 'bezier';
}

export interface EaseFieldProps {
  label: string;
  /** Undefined leaves blits' default for the field. */
  value: Easing | undefined;
  onChange(e: Easing | undefined): void;
  /** What an unset value follows instead, offered as a toggle rather than shown as linear. */
  inherit?: string;
  /** The row's help text, such as the blits doc comment of the field it writes. */
  description?: string;
}

/** Any blits ease as data, on one property row: a curve through weasel's picker, or a count of steps. */
export function EaseField({ label, value, onChange, inherit, description }: EaseFieldProps) {
  const steps = isSteps(value) ? value : undefined;
  const inherited = inherit !== undefined && value === undefined;
  return (
    <PropertyRow group span label={label} description={description}>
      <div className={m.ease}>
        {inherit !== undefined && (
          <PropertyControl
            kind="boolean"
            control="toggle"
            name={`same as ${inherit}`}
            value={inherited}
            onChange={(on) => onChange(on ? undefined : 'linear')}
          />
        )}
        {!inherited && (
          <PropertyControl
            kind="boolean"
            control="toggle"
            name="steps"
            value={steps !== undefined}
            onChange={(on) => onChange(on ? { steps: 4, jump: 'end' } : undefined)}
          />
        )}
        {!inherited &&
          (steps ? (
            <>
              <PropertyControl
                kind="number"
                name={`${label} steps`}
                className={m.count}
                min={1}
                step={1}
                value={steps.steps}
                onChange={(n) => {
                  if (Number.isInteger(n) && n > 0) onChange({ ...steps, steps: n });
                }}
              />
              <PropertyControl
                kind="enum"
                name={`${label} jump`}
                value={steps.jump ?? 'end'}
                options={JUMPS}
                onChange={(jump) => onChange({ ...steps, jump })}
              />
            </>
          ) : (
            <span className={m.curve}>
              <EasingPicker
                value={toWeasel(value)}
                onChange={(next) => {
                  const e = toBlits(next);
                  // null: a curve with no bezier form, which blits cannot hold as data.
                  if (e !== null) onChange(e);
                }}
              />
            </span>
          ))}
      </div>
    </PropertyRow>
  );
}
