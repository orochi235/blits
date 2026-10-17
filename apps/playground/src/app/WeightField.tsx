import type { Expr } from '@pg/blits/composition';
import type { ControlRenderer } from '@weasel-js/labkit';
import { MenuButton, type PrefRenderContext, PropertyControl } from '@weasel-js/ui';
import g from './Group.module.css';
import { ExprRow, errorOf, Row, useSpec } from './SpecFields';

const PRESETS: Record<string, string> = {
  'follow a level': 'slew(level("mouse"), { riseMs: 200, fallMs: 600 })',
  'by column': '(s) => s.x',
  pulse: '(s, set) => 0.5 + 0.5 * Math.sin(set.timestamp / 300 + s.index)',
};
const INSERTS = Object.keys(PRESETS).map((k) => ({ value: k, label: k }));
const FORMS = [
  { value: 'number', label: 'number' },
  { value: 'signal', label: 'signal' },
] as const;

/** A weight: a number from 0 to 1, or a signal typed as code, with a menu of signals to start from. */
export const weightRow: ControlRenderer = (row) => <WeightRow row={row} />;

function WeightRow({ row }: { row: PrefRenderContext }) {
  const spec = useSpec();
  const value = row.value as number | Expr;
  const isNum = typeof value === 'number';
  return (
    <Row row={row} wide>
      <div className={g.actions}>
        <PropertyControl
          kind="enum"
          control="toggle"
          name={`${row.pref.name} form`}
          value={isNum ? 'number' : 'signal'}
          options={FORMS}
          onChange={(form) => row.setValue(form === 'number' ? 1 : { code: '(s) => 1' })}
        />
        {isNum ? (
          <span className={g.num}>
            <PropertyControl
              kind="number"
              name={`${row.pref.name} value`}
              min={0}
              max={1}
              step={0.01}
              value={value}
              onChange={(n) => row.setValue(n)}
            />
          </span>
        ) : (
          <MenuButton
            label="insert…"
            aria-label="insert a weight signal"
            items={INSERTS}
            onAction={(k) => {
              const code = PRESETS[k];
              if (code) row.setValue({ code });
            }}
          />
        )}
      </div>
      {!isNum && (
        <ExprRow
          row={row}
          value={value.code}
          error={errorOf(spec, 'weight')?.error ?? null}
          onCommit={(code) => row.setValue({ code })}
        />
      )}
    </Row>
  );
}
