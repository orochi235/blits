import type { Expr } from '@pg/blits/composition';
import { ExprInput } from '@pg/widgets/ExprInput';
import s from './App.module.css';

const PRESETS: Record<string, string> = {
  'follow a level': 'slew(level("mouse"), { riseMs: 200, fallMs: 600 })',
  'by column': '(s) => s.x',
  pulse: '(s, set) => 0.5 + 0.5 * Math.sin(set.timestamp / 300 + s.index)',
};

export interface WeightFieldProps {
  value: number | Expr;
  error: string | null;
  onChange(w: number | Expr): void;
}

export function WeightField({ value, error, onChange }: WeightFieldProps) {
  const isNum = typeof value === 'number';
  return (
    <div className={s.field}>
      <div className={s.row}>
        <label className={s.row}>
          weight
          <select
            value={isNum ? 'number' : 'signal'}
            onChange={(e) => onChange(e.target.value === 'number' ? 1 : { code: '(s) => 1' })}
          >
            <option value="number">number</option>
            <option value="signal">signal</option>
          </select>
        </label>
        {isNum ? (
          <input
            type="number"
            aria-label="weight value"
            step="any"
            min={0}
            max={1}
            value={value}
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
            }}
          />
        ) : (
          <select
            aria-label="insert a weight signal"
            value=""
            onChange={(e) => {
              const code = PRESETS[e.target.value];
              if (code) onChange({ code });
            }}
          >
            <option value="">insert…</option>
            {Object.keys(PRESETS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </div>
      {!isNum && (
        <ExprInput
          label="signal"
          value={value.code}
          error={error}
          onCommit={(code) => onChange({ code })}
        />
      )}
    </div>
  );
}
