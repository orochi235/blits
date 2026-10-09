import type { Strength } from '@msb235/blits';
import type { Hints } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import s from './App.module.css';
import { docOf } from './docs';

const STRENGTHS: Strength[] = ['weak', 'strong', 'required'];

/** How a voice or group under a span may give way: blits' `SpanHints`. */
export function HintsFields({
  hints,
  onChange,
}: {
  hints: Hints | undefined;
  onChange(h: Hints | undefined): void;
}) {
  const h = hints ?? {};
  const set = <K extends keyof Hints>(key: K, value: Hints[K] | undefined) => {
    const next = withKey(h, key, value);
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const factor = (key: 'faster' | 'slower') => (
    <label className={s.row} title={docOf(`SpanHints.${key}`)}>
      {key}
      <input
        type="number"
        min={1}
        step={0.1}
        value={h[key] ?? 1}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && n >= 1) set(key, n === 1 ? undefined : n);
        }}
      />
    </label>
  );
  const flag = (key: 'overlap' | 'ballast') => (
    <label className={s.row} title={docOf(`SpanHints.${key}`)}>
      <input
        type="checkbox"
        checked={h[key] === true}
        onChange={(e) => set(key, e.target.checked || undefined)}
      />
      {key}
    </label>
  );
  return (
    <fieldset className={s.panel} aria-label="hints">
      <legend>hints</legend>
      {factor('faster')}
      {factor('slower')}
      {flag('overlap')}
      {flag('ballast')}
      <label className={s.row} title={docOf('SpanHints.priority')}>
        priority
        <select
          value={h.priority ?? ''}
          onChange={(e) => set('priority', (e.target.value || undefined) as Strength | undefined)}
        >
          <option value="">default (weak)</option>
          {STRENGTHS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
