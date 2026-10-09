import type { Group, Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { type ConfigField, fromConfigFields } from '@weasel-js/labkit';
import s from './App.module.css';
import { EaseField } from './EaseField';

/** What a voice and a group both carry, under blits' own names. */
type Timed = Voice | Group;

/** The rows a voice's and a group's control panels share, by key. */
export const SHARED: Record<
  'name' | 'start' | 'rate' | 'fadeIn' | 'fadeOut' | 'freeze',
  ConfigField
> = {
  name: { key: 'name', label: 'name', type: 'text', default: '' },
  start: { key: 'start', label: 'start', type: 'number', default: 0, min: 0, step: 10 },
  rate: { key: 'rate', label: 'rate', type: 'slider', default: 1, min: 0, max: 4, step: 0.05 },
  fadeIn: { key: 'fadeIn', label: 'fade in', type: 'number', default: 0, min: 0, step: 10 },
  fadeOut: { key: 'fadeOut', label: 'fade out', type: 'number', default: 0, min: 0, step: 10 },
  freeze: {
    key: 'freeze',
    label: 'freeze',
    type: 'select',
    default: 'none',
    options: ['none', 'before', 'after', 'both'].map((v) => ({ value: v, label: v })),
  },
};

/** The spec member a shared row writes, whose doc comment it shows. */
const MEMBER: Record<string, string> = { fadeIn: 'fade', fadeOut: 'fade' };
export const memberOf = (key: string) => MEMBER[key] ?? key;

/** A control panel schema of `fields`, each row's tooltip `doc(key)`, in `sections`. */
export function schemaOf(
  fields: ConfigField[],
  doc: (key: string) => string | undefined,
  sections: { label: string; paths: string[] }[],
) {
  const resolved = fromConfigFields(fields);
  // `manual` keeps a row's label from toggling it to `auto`, which a spec field has no meaning for.
  for (const [key, leaf] of Object.entries(resolved.group.children))
    Object.assign(leaf, { manual: true, description: doc(key) ?? '' });
  const has = (path: string) => fields.some((f) => f.key === path);
  return {
    ...resolved,
    sections: sections
      .map((x) => ({ at: '', label: x.label, paths: x.paths.filter(has) }))
      .filter((x) => x.paths.length > 0),
  };
}

/** The shared rows' values for `x`. */
export const sharedConfig = (x: Timed) => ({
  name: x.name,
  start: x.start,
  rate: x.rate,
  fadeIn: x.fade.in ?? 0,
  fadeOut: x.fade.out ?? 0,
  freeze: x.freeze ?? 'none',
});

/** A shared row edited and written back into `x`; undefined for a row that is not shared. */
export function writtenShared<T extends Timed>(x: T, path: string, value: unknown): T | undefined {
  const n = Number.isFinite(value) ? (value as number) : undefined;
  switch (path) {
    case 'name':
      return { ...x, name: (value as string) || '' };
    case 'start':
    case 'rate':
      return n === undefined ? x : { ...x, [path]: n };
    case 'fadeIn':
      return n === undefined ? x : { ...x, fade: { ...x.fade, in: n } };
    case 'fadeOut':
      return n === undefined ? x : { ...x, fade: { ...x.fade, out: n } };
    case 'freeze':
      return withKey(x, 'freeze', value === 'none' ? undefined : (value as T['freeze']));
    default:
      return undefined;
  }
}

/** The ease both fades of `x` take. */
export function FadeEase<T extends Timed>({
  x,
  doc,
  onChange,
}: {
  x: T;
  doc: string | undefined;
  onChange(next: T): void;
}) {
  return (
    <div title={doc}>
      <EaseField
        label="fade ease"
        value={x.fade.ease}
        onChange={(ease) => onChange({ ...x, fade: withKey(x.fade, 'ease', ease) })}
      />
    </div>
  );
}

/** `x`'s anchor as data, with a clear button; under a span, which places it, a note says so. */
export function AnchorRow<T extends Timed>({
  x,
  doc,
  spanned,
  onChange,
}: {
  x: T;
  doc: string | undefined;
  spanned: boolean;
  onChange(next: T): void;
}) {
  return (
    <p className={s.row} title={doc}>
      anchor: {x.anchor ? JSON.stringify(x.anchor) : 'none'}
      {spanned && <span className={s.note}>its start: a span places it</span>}
      {x.anchor && (
        <button type="button" onClick={() => onChange(withKey(x, 'anchor', undefined))}>
          clear
        </button>
      )}
    </p>
  );
}

/** Errors on fields a panel has no input for, in a list of their own. */
export function LooseErrors({ errors, label }: { errors: FieldError[]; label: string }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert">
      <ul className={s.errors} aria-label={label}>
        {errors.map((e) => (
          <li key={e.field}>
            {e.field}: {e.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many calls of an expression threw, and the first message; nothing while none have. */
export function FaultLine({ faults }: { faults: Faults | undefined }) {
  if (!faults || faults.count === 0) return null;
  return (
    <p className={s.fault} role="status">
      {faults.count} calls threw; first: {faults.first}
    </p>
  );
}
