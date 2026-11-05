import { Input, useIdleSettle } from '@weasel-js/ui';
import { type KeyboardEvent, useEffect, useState } from 'react';
import s from './ExprInput.module.css';

export interface ExprInputProps {
  value: string;
  onCommit(next: string): void;
  error?: string | null;
  placeholder?: string;
  label: string;
  /** Draw no label: the row around the input already names it, and `label` becomes its accessible name. */
  hideLabel?: boolean;
}

export function ExprInput({
  value,
  onCommit,
  error,
  placeholder,
  label,
  hideLabel = false,
}: ExprInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    idle.stop();
    if (draft !== value) onCommit(draft);
  };
  const idle = useIdleSettle(commit);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      idle.stop();
      setDraft(value);
    }
  };
  return (
    <Input
      className={s.field}
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      isInvalid={Boolean(error)}
      errorMessage={error ?? undefined}
      onChange={(next) => {
        setDraft(next);
        idle.typed();
      }}
      onBlur={commit}
      onKeyDown={key}
    />
  );
}
