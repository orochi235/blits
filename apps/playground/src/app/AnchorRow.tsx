import { PLACEMENTS, parsePlacement } from '@pg/blits/anchor';
import type { Group, Voice } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { ExprInput } from '@pg/widgets/ExprInput';
import { useState } from 'react';
import s from './App.module.css';

/**
 * `x`'s anchor, blits' `Placement` typed as JSON, with a menu of ones to start from; under a
 * span, which places it, a note says so.
 */
export function AnchorRow<T extends Voice | Group>({
  x,
  doc,
  spanned,
  other,
  onChange,
}: {
  x: T;
  doc: string | undefined;
  spanned: boolean;
  /** Another voice's or group's name, which an inserted anchor points at. */
  other: string | undefined;
  onChange(next: T): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const it = other ?? 'intro';
  const commit = (text: string) => {
    const r = parsePlacement(text);
    setError('error' in r ? r.error : null);
    if (!('error' in r)) onChange(withKey(x, 'anchor', r.placement));
  };
  return (
    <div className={s.field} title={doc}>
      <ExprInput
        label="anchor"
        placeholder={`{"start": {"after": "${it}"}}`}
        value={x.anchor ? JSON.stringify(x.anchor) : ''}
        error={error}
        onCommit={commit}
      />
      <div className={s.row}>
        <select
          aria-label="insert an anchor"
          value=""
          onChange={(e) => {
            const make = PLACEMENTS[e.target.value];
            if (make) commit(JSON.stringify(make(it)));
          }}
        >
          <option value="">insert…</option>
          {Object.keys(PLACEMENTS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <span className={s.note}>“it” is {it}</span>
        {x.anchor && (
          <button type="button" onClick={() => commit('')}>
            clear
          </button>
        )}
        {spanned && <span className={s.note}>its start: a span places it</span>}
      </div>
    </div>
  );
}
