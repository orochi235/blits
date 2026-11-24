import { createContext, useContext } from 'react';

type Write = (path: string, value: unknown) => void;

/** Runs an edit with the composition writes it makes shown but not yet recorded as an undo step. */
export const Drafting = createContext<(edit: () => void) => void>((edit) => edit());

/** A `ControlPanel`'s `draftConfig` for its `setConfig` of `write`: a drag is one undo step. */
export function useDraft(write: Write): Write {
  const drafting = useContext(Drafting);
  return (path, value) => drafting(() => write(path, value));
}
