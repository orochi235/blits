import { PLACEMENTS, parsePlacement } from '@pg/blits/anchor';
import { waitableOf } from '@pg/blits/groups';
import type { LeafRenderer } from '@weasel-js/labkit';
import { Button, type LeafContext, MenuButton } from '@weasel-js/ui';
import { useState } from 'react';
import g from './Group.module.css';
import { ExprRow, Row, useSpec } from './SpecFields';

const INSERTS = Object.keys(PLACEMENTS).map((k) => ({ value: k, label: k }));

/**
 * The anchor, blits' `Placement` typed as JSON, with a menu of ones to start from that point at
 * "it", another voice's name; under a span, which places it, the hint says so.
 */
export const anchorRow: LeafRenderer = (row) => <AnchorRow row={row} />;

function AnchorRow({ row }: { row: LeafContext }) {
  const { x, comp, spanned } = useSpec();
  const [error, setError] = useState<string | null>(null);
  const it = waitableOf(comp, x)?.name;
  const commit = (text: string) => {
    const r = parsePlacement(text);
    setError('error' in r ? r.error : null);
    if (!('error' in r)) row.setValue(r.placement);
  };
  return (
    <Row
      row={row}
      wide
      hint={`${it === undefined ? 'no voice to wait on' : `“it” is ${it}`}${spanned ? '; its start: a span places it' : ''}`}
    >
      <ExprRow
        row={row}
        placeholder={`{"start": {"after": "${it ?? 'intro'}"}}`}
        value={x.anchor ? JSON.stringify(x.anchor) : ''}
        error={error}
        onCommit={commit}
      />
      <div className={g.actions}>
        <MenuButton
          label="insert…"
          aria-label="insert an anchor"
          items={INSERTS}
          isDisabled={it === undefined}
          disabledReason="no voice to wait on"
          onAction={(k) => {
            const make = PLACEMENTS[k];
            if (it === undefined) return;
            if (make) commit(JSON.stringify(make(it)));
          }}
        />
        {x.anchor && (
          <Button size="sm" variant="ghost" onClick={() => commit('')}>
            clear
          </Button>
        )}
      </div>
    </Row>
  );
}
