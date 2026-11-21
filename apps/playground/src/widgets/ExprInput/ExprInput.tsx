import { Input, useIdleSettle } from '@weasel-js/ui';
import type { KeyboardEvent } from 'react';
import { useDraft } from '../draft';
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
  const { draft, setDraft, commit: send } = useDraft(value, onCommit);
  const commit = () => {
    idle.stop();
    send();
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
      invalid={Boolean(error)}
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
