import { type KeyboardEvent, useEffect, useState } from 'react';
import s from './CodePane.module.css';

export interface CodePaneProps {
  value: string;
  onCommit(next: string): void;
  error?: string | null;
  errorLine?: number | null; // null: the message shows without a gutter mark
  label: string;
  rows?: number;
}

export function CodePane({ value, onCommit, error, errorLine, label, rows = 6 }: CodePaneProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const at = el.selectionStart;
      setDraft(`${draft.slice(0, at)}  ${draft.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
    }
  };
  const lines = Math.max(rows, draft.split('\n').length);
  return (
    <div className={s.pane}>
      <span className={s.label}>{label}</span>
      <div className={error ? s.bodyBad : s.body}>
        <ol className={s.gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the gutter is positional
            <li key={i} className={i + 1 === errorLine ? s.marked : undefined}>
              {i + 1}
            </li>
          ))}
        </ol>
        <textarea
          className={s.code}
          value={draft}
          rows={lines}
          wrap="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={key}
        />
      </div>
      {error && (
        <span className={s.error} role="alert">
          {errorLine ? `line ${errorLine}: ` : ''}
          {error}
        </span>
      )}
    </div>
  );
}
