import { FIT_PRESETS, type FitStep } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { CodePane } from '@pg/widgets/CodePane';
import s from './App.module.css';
import g from './Group.module.css';
import { FaultLine } from './SpecFields';

type Kind = FitStep['kind'];
const KINDS: readonly Kind[] = ['condense', 'shed', 'overrun', 'conclude', 'code'];
const PRESETS = Object.keys(FIT_PRESETS) as (keyof typeof FIT_PRESETS)[];
/** The preset menu's entry for an unset fit, which plays blits' own default. */
const BLITS = 'blits default';

const fresh = (kind: Kind): FitStep =>
  kind === 'code' ? { kind, code: '(span, kids, plan) => plan' } : { kind };

const same = (a: readonly FitStep[], b: readonly FitStep[]) =>
  JSON.stringify(a) === JSON.stringify(b);

export interface FitStepsProps {
  /** Undefined plays blits' default fit. */
  steps: FitStep[] | undefined;
  onChange(steps: FitStep[] | undefined): void;
  /** Code step `i`'s compile error. */
  errorOf(i: number): { error: string; line: number | null } | null;
  /** How often code step `i` threw as it ran. */
  faultsOf(i: number): Faults | undefined;
  doc: string | undefined;
}

/** A span's fit as a list of blits' fit steps, run in order: `pipe(...)`. */
export function FitSteps({ steps, onChange, errorOf, faultsOf, doc }: FitStepsProps) {
  // Adding to an unset fit starts from the default it was playing.
  const list: FitStep[] = steps ?? [...FIT_PRESETS.default];
  const preset =
    steps === undefined ? BLITS : (PRESETS.find((p) => same(FIT_PRESETS[p], steps)) ?? '');
  const put = (i: number, step: FitStep) => onChange(list.map((x, j) => (j === i ? step : x)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by] as FitStep, next[i] as FitStep];
    onChange(next);
  };
  return (
    <fieldset className={s.panel} aria-label="fit" title={doc}>
      <legend>fit</legend>
      <label className={s.row}>
        preset
        <select
          value={preset}
          onChange={(e) => {
            const p = e.target.value;
            onChange(p === BLITS ? undefined : [...FIT_PRESETS[p as keyof typeof FIT_PRESETS]]);
          }}
        >
          <option value="" disabled>
            custom
          </option>
          <option value={BLITS}>{BLITS}</option>
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}: {FIT_PRESETS[p].map((x) => x.kind).join(', ')}
            </option>
          ))}
        </select>
      </label>
      {steps === undefined && <p className={s.note}>condense, then shed</p>}
      {steps !== undefined && (
        <ol className={g.steps}>
          {list.map((step, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and may repeat
            <li key={i} className={g.step}>
              <div className={s.row}>
                <span className={g.kind}>{step.kind}</span>
                {step.kind === 'overrun' && (
                  <label
                    className={s.row}
                    title="up to this many times its budget; empty for no limit"
                  >
                    cap
                    <input
                      type="number"
                      className={s.number}
                      min={1}
                      step={0.1}
                      placeholder="none"
                      value={step.cap ?? ''}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber;
                        put(
                          i,
                          Number.isFinite(n) && n > 0
                            ? { kind: 'overrun', cap: n }
                            : { kind: 'overrun' },
                        );
                      }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  aria-label="move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="move down"
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="remove"
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
              {step.kind === 'code' && (
                <>
                  <CodePane
                    label="(span, kids, plan) => plan"
                    rows={3}
                    value={step.code}
                    error={errorOf(i)?.error ?? null}
                    errorLine={errorOf(i)?.line ?? null}
                    onCommit={(code) => put(i, { kind: 'code', code })}
                  />
                  <FaultLine faults={faultsOf(i)} />
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      <select
        aria-label="add a fit step"
        value=""
        onChange={(e) => onChange([...list, fresh(e.target.value as Kind)])}
      >
        <option value="" disabled>
          add step…
        </option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
