import type { FitResult } from '@msb235/blits';
import { docOf } from './docs';
import g from './Group.module.css';

const ms = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1).padStart(7)} ms` : '   none   ');

/** How a span's children were last fitted, read afresh every frame. */
export function FitReadout({ result: r }: { result: FitResult }) {
  const cells: [keyof FitResult, string][] = [
    ['budget', ms(r.budget)],
    ['length', ms(r.length)],
    ['over', ms(r.over)],
    ['skipped', String(r.skipped).padStart(3)],
    ['fell', r.fell ? 'yes' : ' no'],
  ];
  return (
    <dl className={g.result} aria-label="fit result">
      {cells.map(([k, text]) => (
        <div key={k} title={docOf(`FitResult.${k}`)}>
          <dt>{k}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}
