import { PLACEMENTS, parsePlacement } from '@pg/blits/anchor';
import type { ControlRenderer } from '@weasel-js/labkit';
import { Button, MenuButton, type PrefRenderContext } from '@weasel-js/ui';
import { useState } from 'react';
import g from './Group.module.css';
import { ExprRow, Row, useSpec } from './SpecFields';

const INSERTS = Object.keys(PLACEMENTS).map((k) => ({ value: k, label: k }));

/**
 * The anchor, blits' `Placement` typed as JSON, with a menu of ones to start from that point at
 * "it", another voice's name; under a span, which places it, the hint says so.
 */
export const anchorRow: ControlRenderer = (row) => <AnchorRow row={row} />;

function AnchorRow({ row }: { row: PrefRenderContext }) {
  const { x, comp, spanned } = useSpec();
  const [error, setError] = useState<string | null>(null);
  const it =
    ('patch' in x ? comp.voices.find((o) => o.id !== x.id) : comp.voices[0])?.name ?? 'intro';
  const commit = (text: string) => {
    const r = parsePlacement(text);
    setError('error' in r ? r.error : null);
    if (!('error' in r)) row.setValue(r.placement);
  };
  return (
    <Row row={row} wide hint={`“it” is ${it}${spanned ? '; its start: a span places it' : ''}`}>
      <ExprRow
        row={row}
        placeholder={`{"start": {"after": "${it}"}}`}
        value={x.anchor ? JSON.stringify(x.anchor) : ''}
        error={error}
        onCommit={commit}
      />
      <div className={g.actions}>
        <MenuButton
          label="insert…"
          aria-label="insert an anchor"
          items={INSERTS}
          onAction={(k) => {
            const make = PLACEMENTS[k];
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
