import type { Composition } from '@pg/blits/composition';
import { ancestorsOf } from '@pg/blits/groups';
import s from './App.module.css';

/**
 * The group a voice or group `id` plays under, chosen from those it may join: never itself or a
 * group it holds, and never a span for an owner.
 */
export function OwnerField({
  comp,
  id,
  doc,
  error,
  onChange,
}: {
  comp: Composition;
  id: string;
  doc: string | undefined;
  error: string | null;
  onChange(owner: string | null): void;
}) {
  const self = comp.groups?.find((g) => g.id === id);
  const voice = comp.voices.find((v) => v.id === id);
  const offered = (comp.groups ?? []).filter(
    (g) =>
      !self ||
      (g.id !== id &&
        !ancestorsOf(comp, g.id).some((a) => a.id === id) &&
        !(self.kind === 'owner' && g.kind === 'span')),
  );
  return (
    <div className={s.field}>
      <label className={s.row} title={doc}>
        owner
        <select
          value={(self ?? voice)?.owner ?? ''}
          aria-invalid={error !== null}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">none (the mix)</option>
          {offered.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {g.kind}
            </option>
          ))}
        </select>
      </label>
      {error !== null && (
        <p className={s.fault} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
