import { type KeyboardEvent, useEffect, useId, useState } from 'react';
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
  const id = useId();
  const errorId = `${id}-error`;
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(value);
  };
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={error ? s.bad : s.input}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={key}
      />
      {error && (
        <span id={errorId} className={s.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
