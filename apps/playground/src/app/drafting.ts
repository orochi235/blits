import { createContext, useContext } from 'react';

type Write = (path: string, value: unknown) => void;

export interface Draftable {
  /** Runs an edit with the composition writes it makes shown but not yet recorded as an undo step. */
  drafting(edit: () => void): void;
  /** Records the drafts on screen as one undo step. */
  settle(): void;
}

export const Drafting = createContext<Draftable>({ drafting: (edit) => edit(), settle: () => {} });

/** A `ControlPanel`'s `draftConfig` for its `setConfig` of `write`: a drag is one undo step. */
export function useDraft(write: Write): Write {
  const { drafting } = useContext(Drafting);
  return (path, value) => drafting(() => write(path, value));
}

/** What ends a burst of commits from one control: the key or button let go, or focus leaving it. */
const ENDS = ['pointerup', 'keyup', 'focusout', 'click'] as const;
/** How long a burst nothing ends waits before it is one step anyway, ms: longer than a held spinner's repeat. */
const REST_MS = 1000;

let ending: { done: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

function settleOnEnd(settle: () => void) {
  if (ending) {
    clearTimeout(ending.timer);
    ending.timer = setTimeout(ending.done, REST_MS);
    return;
  }
  // Listened for on window, past the root React handles events at, so a commit made on blur
  // settles in that same focusout.
  const done = () => {
    if (ending) clearTimeout(ending.timer);
    for (const e of ENDS) window.removeEventListener(e, done);
    ending = null;
    settle();
  };
  for (const e of ENDS) window.addEventListener(e, done);
  ending = { done, timer: setTimeout(done, REST_MS) };
}

/**
 * `write` for a control outside a `ControlPanel` that commits a burst of values: a held spinner,
 * whose every step is a commit. Each is shown as a draft, and the burst is one undo step once the
 * key or button comes up, focus leaves, or it rests.
 */
export function burstOf<A extends unknown[]>(
  to: Draftable,
  write: (...a: A) => void,
): (...a: A) => void {
  return (...a) => {
    to.drafting(() => write(...a));
    settleOnEnd(to.settle);
  };
}

export type Burst = <A extends unknown[]>(write: (...a: A) => void) => (...a: A) => void;

/** `burstOf` with the playground's composition. */
export function useBurst(): Burst {
  const to = useContext(Drafting);
  return (write) => burstOf(to, write);
}
