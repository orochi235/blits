import type { FitResult } from '@msb235/blits';
import type { ControlRenderer } from '@weasel-js/labkit';
import num from '@weasel-js/theme/numeric.module.css';
import { type PrefRenderContext, PropertyRow } from '@weasel-js/ui';
import { docOf } from './docs';
import g from './Group.module.css';
import { msWide } from './ms';
import { useSpec } from './SpecFields';

/** How a span's children were last fitted, read afresh every frame. */
export function FitReadout({ result: r }: { result: FitResult }) {
  const cells: [keyof FitResult, string][] = [
    ['budget', msWide(r.budget)],
    ['length', msWide(r.length)],
    ['over', msWide(r.over)],
    ['skipped', String(r.skipped).padStart(3)],
    ['fell', r.fell ? 'yes' : ' no'],
  ];
  return (
    <dl className={g.result} aria-label="fit result">
      {cells.map(([k, text]) => (
        <div key={k} title={docOf(`FitResult.${k}`)}>
          <dt>{k}</dt>
          <dd className={num.numeric}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The running span's last fit, or a note that it is not running. */
export const resultRow: ControlRenderer = (row) => <ResultRow row={row} />;

function ResultRow({ row }: { row: PrefRenderContext }) {
  const { result } = useSpec();
  return (
    <PropertyRow
      group
      span
      label={row.pref.name}
      hint={result ? undefined : 'not running: no fit to show'}
    >
      {result ? <FitReadout result={result} /> : null}
    </PropertyRow>
  );
}
