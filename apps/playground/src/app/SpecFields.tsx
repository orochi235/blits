import type { FitResult } from '@msb235/blits';
import type { Composition, Group, Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ExprInput } from '@pg/widgets/ExprInput';
import {
  BaseNode,
  type ConfigShape,
  type ControlRenderer,
  f,
  GroupNode,
  isConfigBranch,
  resolveConfigSchema,
} from '@weasel-js/labkit';
import {
  Button,
  type PrefRenderContext,
  PropertyControl,
  PropertyRow,
  prefFieldProps,
} from '@weasel-js/ui';
import { createContext, type ReactNode, useContext, useRef } from 'react';
import { drafted } from './CompositionControls';
import { EaseField } from './EaseField';
import g from './Group.module.css';

/** What a voice and a group both carry, under blits' own names. */
export type Timed = Voice | Group;

/** What a voice's or group's rows read beyond their own value. */
export interface Spec {
  x: Timed;
  comp: Composition;
  /** Under a span, which places it. */
  spanned: boolean;
  /** Every compile error of the composition. */
  errors: FieldError[];
  /** Faults by voice or group id, and by `fitFaultKey` for each code fit step. */
  faultsOf(key: string): Faults | undefined;
  /** For a running span, how it last fitted its children. */
  result?: FitResult;
  onDelete(): void;
}

const SpecContext = createContext<Spec | null>(null);
export const SpecProvider = SpecContext.Provider;

export function useSpec(): Spec {
  const spec = useContext(SpecContext);
  if (!spec) throw new Error('a spec row outside a SpecProvider');
  return spec;
}

/** `x`'s own compile error on `field`. */
export const errorOf = (spec: Spec, field: string): FieldError | null =>
  spec.errors.find((e) => e.voice === spec.x.id && e.field === field) ?? null;

/**
 * A control panel schema of `shape`. Every leaf is `manual`: a spec field has no `auto`, so its label
 * never toggles one.
 */
export function specSchema(shape: ConfigShape) {
  const manual = (s: ConfigShape): ConfigShape =>
    Object.fromEntries(
      Object.entries(s).map(([key, entry]) => [
        key,
        isConfigBranch(entry)
          ? new GroupNode(manual(entry.children), entry.annotations, entry.options)
          : entry instanceof BaseNode
            ? entry.manual()
            : entry,
      ]),
    );
  return resolveConfigSchema(f.schema(manual(shape)));
}

/** A `showIf` / `enableIf` over a panel's config, typed as the panel builds it. */
export const when =
  <C,>(test: (c: C) => boolean) =>
  (c: Record<string, unknown>) =>
    test(c as C);

/**
 * A row drawn by hand, in the panel's own frame: its label and doc comment, a muted `hint` after the
 * label, and an `error` under the controls. `wide` takes the panel's whole width.
 */
export function Row({
  row,
  label = row.pref.name,
  hint,
  readout,
  wide,
  error,
  children,
}: {
  row: PrefRenderContext;
  label?: string;
  hint?: ReactNode;
  /** A value read off the row, beside its label. */
  readout?: ReactNode;
  wide?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <PropertyRow
      group
      span={wide}
      label={label}
      description={row.pref.description || undefined}
      hint={hint}
      readout={readout}
      disabled={row.disabled}
    >
      <div className={g.cell}>
        {children}
        {error && (
          <span className={g.error} role="alert">
            {error}
          </span>
        )}
      </div>
    </PropertyRow>
  );
}

/** The leaf's own control, with `hint` after its label, or `off` while it is disabled. */
export const noted =
  (hint?: string, off?: string): ControlRenderer =>
  (row) => {
    const field = prefFieldProps(row.pref, { value: row.value, setValue: row.setValue }, 'lab');
    if (!field) return null;
    return (
      <PropertyRow
        label={row.pref.name}
        description={row.pref.description || undefined}
        hint={row.disabled ? (off ?? hint) : hint}
        disabled={row.disabled}
      >
        <PropertyControl
          {...field}
          {...(field.kind === 'number' ? { onInput: () => {} } : {})}
          name={row.pref.name}
          disabled={row.disabled}
        />
      </PropertyRow>
    );
  };

export interface OptionalNumber {
  placeholder: string | ((spec: Spec) => string);
  hint?: string | ((spec: Spec) => string);
  min?: number;
  step?: number;
  unit?: string;
}

const read = <T,>(v: T | ((spec: Spec) => T), spec: Spec): T =>
  typeof v === 'function' ? (v as (spec: Spec) => T)(spec) : v;

/**
 * Wraps a number field so that emptying it and leaving writes `onEmpty`: the field itself drops an
 * empty commit, so it is caught on the way out. Escape still reverts.
 */
export function Emptiable({ onEmpty, children }: { onEmpty(): void; children: ReactNode }) {
  const escaped = useRef(false);
  return (
    <span
      className={g.num}
      onKeyDownCapture={(e) => {
        escaped.current = e.key === 'Escape';
      }}
      onBlurCapture={(e) => {
        const text = (e.target as HTMLInputElement).value;
        if (!escaped.current && text.trim() === '') onEmpty();
        escaped.current = false;
      }}
    >
      {children}
    </span>
  );
}

/** A number that may be unset, which blits then defaults: emptied, the field writes undefined. */
function OptionalNumberRow({ row, o }: { row: PrefRenderContext; o: OptionalNumber }) {
  const spec = useSpec();
  const value = typeof row.value === 'number' ? row.value : undefined;
  return (
    <Row row={row} hint={o.hint === undefined ? undefined : read(o.hint, spec)}>
      <Emptiable onEmpty={() => value !== undefined && row.setValue(undefined)}>
        <PropertyControl
          kind="number"
          name={row.pref.name}
          value={value}
          placeholder={read(o.placeholder, spec)}
          min={o.min}
          step={o.step}
          unit={o.unit}
          disabled={row.disabled}
          onChange={(n) => row.setValue(o.min !== undefined && n < o.min ? o.min : n)}
        />
      </Emptiable>
    </Row>
  );
}

export const optionalNumber =
  (o: OptionalNumber): ControlRenderer =>
  (row) => <OptionalNumberRow row={row} o={o} />;

/** An optional number leaf: `undefined` until set. */
export const optional = () => f.custom<number | undefined>('optional-number', undefined);

/**
 * An expression typed as code, committed on Enter or blur as one step, its compile error under it.
 * The label is the row's, and names the input for assistive tech.
 */
export function ExprRow({
  row,
  placeholder,
  error,
  value = typeof row.value === 'string' ? row.value : '',
  onCommit = (code) => row.setValue(code),
}: {
  row: PrefRenderContext;
  placeholder?: string;
  error: string | null;
  value?: string;
  onCommit?(code: string): void;
}) {
  return (
    <ExprInput
      label={row.pref.name}
      hideLabel
      placeholder={placeholder}
      value={value}
      error={error}
      onCommit={onCommit}
    />
  );
}

/** A code row: the leaf's value is the code, blank for none. */
export const exprRow =
  (placeholder: string): ControlRenderer =>
  (row) => <CodeRow row={row} placeholder={placeholder} />;

function CodeRow({ row, placeholder }: { row: PrefRenderContext; placeholder: string }) {
  const spec = useSpec();
  return (
    <Row row={row} wide>
      <ExprRow row={row} placeholder={placeholder} error={errorOf(spec, row.path)?.error ?? null} />
    </Row>
  );
}

/** The ease both fades take, on a row of its own. */
export const fadeEaseRow: ControlRenderer = (row) => (
  <EaseField
    label={row.pref.name}
    description={row.pref.description || undefined}
    value={row.value as Timed['fade']['ease']}
    onChange={(ease) => row.setValue(ease)}
  />
);

/** Removes the voice or group. */
export const deleteRow =
  (label: string): ControlRenderer =>
  () => <DeleteButton label={label} />;

function DeleteButton({ label }: { label: string }) {
  const spec = useSpec();
  return (
    <PropertyRow group span layout="inline" label="">
      <Button size="sm" onClick={spec.onDelete}>
        {label}
      </Button>
    </PropertyRow>
  );
}

/** Errors on fields that have no row of their own, in a list. */
export const looseErrorsRow =
  (fields: ReadonlySet<string>): ControlRenderer =>
  (row) => <LooseErrors fields={fields} label={row.pref.name} />;

function LooseErrors({ fields, label }: { fields: ReadonlySet<string>; label: string }) {
  const spec = useSpec();
  const loose = spec.errors.filter((e) => e.voice === spec.x.id && fields.has(e.field));
  if (loose.length === 0) return null;
  return (
    <div className={g.wide} role="alert">
      <ul className={g.errors} aria-label={label}>
        {loose.map((e) => (
          <li key={e.field}>
            {e.field}: {e.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many calls of `x`'s expressions threw, and the first message; nothing while none have. */
export const faultsRow: ControlRenderer = () => <XFaults />;

function XFaults() {
  const spec = useSpec();
  const faults = spec.faultsOf(spec.x.id);
  return faults?.count ? (
    <div className={g.wide}>
      <FaultLine faults={faults} />
    </div>
  ) : null;
}

/** How many calls of an expression threw, and the first message; nothing while none have. */
export function FaultLine({ faults }: { faults: Faults | undefined }) {
  if (!faults || faults.count === 0) return null;
  return (
    <p className={g.error} role="status">
      {faults.count} calls threw; first: {faults.first}
    </p>
  );
}

/** The rows a voice's and a group's panels share, each described by `doc(member)`. */
export function sharedNodes(doc: (member: string) => string | undefined) {
  const d = (member: string) => doc(member) ?? '';
  return {
    name: f.string('').describe(d('name')).render(drafted()),
    start: f.number(0).step(10).describe(d('start')).render(drafted()),
    seek: optional().label('seek').describe(d('seek')),
    fadeIn: f.number(0).step(10).label('fade in').describe(d('fade')).render(drafted()),
    fadeOut: f.number(0).step(10).label('fade out').describe(d('fade')).render(drafted()),
    fadeEase: f
      .custom<Timed['fade']['ease']>('ease', undefined)
      .label('fade ease')
      .render(fadeEaseRow)
      .describe(d('fade')),
    freeze: f.enum('none', ['none', 'before', 'after', 'both']).describe(d('freeze')),
  };
}

/** The shared rows' values for `x`. */
export const sharedConfig = (x: Timed) => ({
  name: x.name,
  start: x.start,
  rate: x.rate,
  seek: x.seek,
  fadeIn: x.fade.in ?? 0,
  fadeOut: x.fade.out ?? 0,
  fadeEase: x.fade.ease,
  freeze: x.freeze ?? 'none',
});

/** A shared row edited and written back into `x`; undefined for a row that is not shared. */
export function writtenShared<T extends Timed>(x: T, path: string, value: unknown): T | undefined {
  const n = Number.isFinite(value) ? (value as number) : undefined;
  switch (path) {
    case 'name':
      return { ...x, name: (value as string) || '' };
    case 'start':
      return n === undefined ? x : { ...x, start: Math.max(0, n) };
    case 'rate':
      return n === undefined ? x : { ...x, rate: n };
    case 'seek':
      return withKey(x, 'seek', n);
    case 'fadeIn':
      return n === undefined ? x : { ...x, fade: { ...x.fade, in: Math.max(0, n) } };
    case 'fadeOut':
      return n === undefined ? x : { ...x, fade: { ...x.fade, out: Math.max(0, n) } };
    case 'fadeEase':
      return { ...x, fade: withKey(x.fade, 'ease', value as Timed['fade']['ease']) };
    case 'freeze':
      return withKey(x, 'freeze', value === 'none' ? undefined : (value as T['freeze']));
    default:
      return undefined;
  }
}
