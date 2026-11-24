import { createHistory, createSwapOp } from '@weasel-js/history';

const DEPTH = 200;

/**
 * A value's undo history. `set` records a step; `draft` shows a value a control is passing
 * through (a slider's drag, a number being typed) without recording it, and the `set` that
 * settles it records one step from the value before the first draft.
 */
export function createEdits<T>(start: T, emit: (x: T) => void, depth = DEPTH) {
  const history = createHistory(null, { historyLimit: depth });
  let now = start;
  /** The value from before the drafts on screen, while there are any. */
  let held: { before: T } | null = null;
  let routed = false;
  const show = (x: T) => {
    now = x;
    emit(x);
  };
  const draft = (next: T) => {
    if (next === now) return;
    held ??= { before: now };
    show(next);
  };
  const set = (next: T) => {
    if (routed) return draft(next);
    const before = held ? held.before : now;
    held = null;
    if (next === before) {
      if (now !== before) show(before);
      return;
    }
    history.apply(createSwapOp({ name: 'edit', label: 'edit', before, after: next, emit: show }));
  };
  /** Puts back the value from before the drafts, if any are on screen. */
  const drop = () => {
    if (!held) return false;
    const { before } = held;
    held = null;
    show(before);
    return true;
  };
  return {
    now: () => now,
    set,
    draft,
    /** Runs `edit` with every `set` it makes taken as a `draft`. */
    drafting(edit: () => void) {
      routed = true;
      try {
        edit();
      } finally {
        routed = false;
      }
    },
    /** Records the drafts on screen as one step, as a `set` of the value they reached would. */
    settle() {
      if (held) set(now);
    },
    undo() {
      if (!drop()) history.undo();
    },
    redo() {
      drop();
      history.redo();
    },
    canUndo: () => held !== null || history.canUndo(),
    canRedo: () => history.canRedo(),
  };
}
