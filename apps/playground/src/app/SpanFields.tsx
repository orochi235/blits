import type { FitResult, Order, Strength } from '@msb235/blits';
import type { SpanSettings } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import s from './App.module.css';
import { docOf } from './docs';
import { FitReadout } from './FitReadout';
import { FitSteps } from './FitSteps';

const STRENGTHS: Strength[] = ['weak', 'strong', 'required'];
const ORDERS: Order[] = ['queue', 'stagger', 'together'];
const SPILLS: NonNullable<SpanSettings['spill']>[] = ['instant', 'overrun'];

export interface SpanFieldsProps {
  span: SpanSettings;
  onChange(span: SpanSettings): void;
  errorOf(field: string): { error: string; line: number | null } | null;
  faultsOf(step: number): Faults | undefined;
  /** How the running span last fitted its children; undefined while it is not running. */
  result: FitResult | undefined;
}

/** A span's own settings: its budget and how it lays out and fits what it holds. */
export function SpanFields({ span: sp, onChange, errorOf, faultsOf, result }: SpanFieldsProps) {
  const set = <K extends keyof SpanSettings>(key: K, value: SpanSettings[K] | undefined) =>
    onChange(withKey(sp, key, value));
  const choice = <K extends 'priority' | 'order' | 'spill'>(
    key: K,
    options: readonly NonNullable<SpanSettings[K]>[],
    fallback: string,
  ) => (
    <label className={s.row} title={docOf(`SpanSpec.${key}`)}>
      {key}
      <select
        value={sp[key] ?? ''}
        onChange={(e) => set(key, (e.target.value || undefined) as SpanSettings[K])}
      >
        <option value="">default ({fallback})</option>
        {options.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset className={s.panel} aria-label="span">
      <legend>span</legend>
      <label className={s.row} title={docOf('SpanSpec.duration')}>
        duration
        <input
          type="number"
          className={s.number}
          min={0}
          step={50}
          placeholder="none"
          value={sp.duration ?? ''}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            set('duration', Number.isFinite(n) && n >= 0 ? n : undefined);
          }}
        />
        ms
      </label>
      {choice('priority', STRENGTHS, 'strong')}
      {choice('order', ORDERS, 'queue')}
      {sp.order === 'stagger' && (
        <label className={s.row} title={docOf('SpanSpec.share')}>
          share
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sp.share ?? 0.5}
            onChange={(e) => set('share', Number(e.target.value))}
          />
          <output className={s.readout}>{(sp.share ?? 0.5).toFixed(2)}</output>
        </label>
      )}
      {choice('spill', SPILLS, 'instant')}
      <FitSteps
        steps={sp.fit}
        onChange={(fit) => set('fit', fit)}
        errorOf={(i) => errorOf(`span.fit.${i}`)}
        faultsOf={faultsOf}
        doc={docOf('SpanSpec.fit')}
      />
      {result ? (
        <FitReadout result={result} />
      ) : (
        <p className={s.note}>not running: no fit to show</p>
      )}
    </fieldset>
  );
}
