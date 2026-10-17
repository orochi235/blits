import { FIT_PRESETS, type FitStep } from '@pg/blits/composition';
import { fitFaultKey } from '@pg/blits/cueGroups';
import { CodePane } from '@pg/widgets/CodePane';
import type { ControlRenderer } from '@weasel-js/labkit';
import {
  Button,
  CloseButton,
  MenuButton,
  type PrefRenderContext,
  PropertyControl,
} from '@weasel-js/ui';
import g from './Group.module.css';
import { Emptiable, errorOf, FaultLine, Row, useSpec } from './SpecFields';

type Kind = FitStep['kind'];
const KINDS: readonly Kind[] = ['condense', 'shed', 'overrun', 'conclude', 'code'];
const PRESETS = Object.keys(FIT_PRESETS) as (keyof typeof FIT_PRESETS)[];
/** The preset menu's entry for an unset fit, which plays blits' own default. */
const BLITS = 'blits default';
/** The preset menu's entry for steps no preset matches; never chosen. */
const CUSTOM = 'custom';
const PRESET_OPTIONS = [
  { value: CUSTOM, label: CUSTOM, disabled: true },
  { value: BLITS, label: BLITS },
  ...PRESETS.map((p) => ({
    value: p,
    label: `${p}: ${FIT_PRESETS[p].map((x) => x.kind).join(', ')}`,
  })),
];
const ADDS = KINDS.map((k) => ({ value: k, label: k }));

const fresh = (kind: Kind): FitStep =>
  kind === 'code' ? { kind, code: '(span, kids, plan) => plan' } : { kind };

const same = (a: readonly FitStep[], b: readonly FitStep[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A span's fit as a list of blits' fit steps, run in order: `pipe(...)`. Undefined plays blits' default. */
export const fitRow: ControlRenderer = (row) => <FitRow row={row} />;

function FitRow({ row }: { row: PrefRenderContext }) {
  const spec = useSpec();
  const steps = row.value as FitStep[] | undefined;
  const onChange = (next: FitStep[] | undefined) => row.setValue(next);
  // Adding to an unset fit starts from the default it was playing.
  const list: FitStep[] = steps ?? [...FIT_PRESETS.default];
  const preset =
    steps === undefined ? BLITS : (PRESETS.find((p) => same(FIT_PRESETS[p], steps)) ?? CUSTOM);
  const put = (i: number, step: FitStep) => onChange(list.map((x, j) => (j === i ? step : x)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by] as FitStep, next[i] as FitStep];
    onChange(next);
  };
  return (
    <Row row={row} wide hint={steps === undefined ? 'condense, then shed' : undefined}>
      <div className={g.actions}>
        <span className={g.fill}>
          <PropertyControl
            kind="enum"
            name="fit preset"
            value={preset}
            options={PRESET_OPTIONS}
            onChange={(p) =>
              onChange(p === BLITS ? undefined : [...FIT_PRESETS[p as keyof typeof FIT_PRESETS]])
            }
          />
        </span>
        <MenuButton
          label="add step…"
          aria-label="add a fit step"
          items={ADDS}
          onAction={(k) => onChange([...list, fresh(k)])}
        />
      </div>
      {steps !== undefined && (
        <ol className={g.steps}>
          {list.map((step, i) => {
            const error = errorOf(spec, `span.fit.${i}`);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and may repeat
              <li key={i} className={g.step}>
                <div className={g.actions}>
                  <span className={g.kind}>{step.kind}</span>
                  {step.kind === 'overrun' && (
                    <span
                      className={g.cap}
                      title="up to this many times its budget; empty for no limit"
                    >
                      cap
                      <Emptiable onEmpty={() => put(i, { kind: 'overrun' })}>
                        <PropertyControl
                          kind="number"
                          name="cap"
                          min={1}
                          step={0.1}
                          placeholder="none"
                          value={step.cap}
                          onChange={(n) =>
                            put(i, n > 0 ? { kind: 'overrun', cap: n } : { kind: 'overrun' })
                          }
                        />
                      </Emptiable>
                    </span>
                  )}
                  <span className={g.end}>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      ariaLabel="move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      ariaLabel="move down"
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                    <CloseButton
                      ariaLabel={`remove ${step.kind}`}
                      onClick={() => onChange(list.filter((_, j) => j !== i))}
                    />
                  </span>
                </div>
                {step.kind === 'code' && (
                  <>
                    <CodePane
                      label="(span, kids, plan) => plan"
                      rows={3}
                      value={step.code}
                      error={error?.error ?? null}
                      errorLine={error?.line ?? null}
                      onCommit={(code) => put(i, { kind: 'code', code })}
                    />
                    <FaultLine faults={spec.faultsOf(fitFaultKey(spec.x.id, i))} />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Row>
  );
}
