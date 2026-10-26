import { blendOf, stopOf } from '@pg/blits/blend';
import type { Voice } from '@pg/blits/composition';
import type { ControlRenderer } from '@weasel-js/labkit';
import { Button, type PrefRenderContext } from '@weasel-js/ui';
import g from './Group.module.css';
import { ExprRow, Row, useSpec } from './SpecFields';

const FRESH = '(s) => s.x';

/**
 * A role cued by `mix.blend`: the one signal its voices split, in place of a weight each. Writes the
 * blend's `by`, or undefined to go back to each voice's own weight.
 */
export const blendRow: ControlRenderer = (row) => <BlendRow row={row} />;

function BlendRow({ row }: { row: PrefRenderContext }) {
  const { x, comp, errors } = useSpec();
  const v = x as Voice;
  const blend = blendOf(comp, v);
  if (!blend)
    return (
      <Row row={row} hint="one signal in place of a weight each">
        <Button size="sm" onClick={() => row.setValue({ code: FRESH })}>
          blend role “{v.role}”
        </Button>
      </Row>
    );
  const n = blend.members.length;
  const i = blend.members.findIndex((m) => m.id === v.id);
  const error = errors.find(
    (e) => e.field === 'blend' && blend.members.some((m) => m.id === e.voice),
  );
  return (
    <Row
      row={row}
      label="blend by"
      wide
      readout={`stop ${i + 1} of ${n}: full at ${stopOf(i, n).toFixed(2)}`}
    >
      <ExprRow
        row={row}
        placeholder={FRESH}
        value={blend.by.code}
        error={error?.error ?? null}
        onCommit={(code) => {
          if (code.trim() !== '') row.setValue({ code });
        }}
      />
      <div className={g.actions}>
        <Button size="sm" variant="ghost" onClick={() => row.setValue(undefined)}>
          unblend
        </Button>
        <span className={g.note}>
          One spec plays every voice of a blend: a change here to timing, fade, stagger, target,
          freeze, anchor, or owner is made to all of them.
        </span>
      </div>
    </Row>
  );
}
