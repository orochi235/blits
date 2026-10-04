import { type KeyboardEvent, useEffect, useState } from 'react';
import s from './ExprInput.module.css';

export interface ExprInputProps {
  value: string;
  onCommit(next: string): void;
  error?: string | null;
  placeholder?: string;
  label: string;
}

export function ExprInput({ value, onCommit, error, placeholder, label }: ExprInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(value);
  };
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <input
        className={error ? s.bad : s.input}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={key}
      />
      {error && (
        <span className={s.error} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
