import { useEffect, useRef, useState } from 'react';

/** A field's text being edited, committed when it differs from `value`, and only once: a draft
 *  the parent turned down, leaving `value` as it was, is not sent again until it changes. */
export function useDraft(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    setDraft(value);
    sent.current = null;
  }, [value]);
  const commit = () => {
    if (draft === value || draft === sent.current) return;
    sent.current = draft;
    onCommit(draft);
  };
  return { draft, setDraft, commit };
}
