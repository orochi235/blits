/** Fields whose own Mod+Z steps back their text; any other input keeps no undo of its own. */
const TEXT = [
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].reduce(
    (sel, type) => `${sel}:not([type=${type}])`,
    'input',
  ),
].join(', ');

/** Whether Mod+Z at `target` belongs to the field there rather than the composition's history. */
export function keepsOwnUndo(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT) !== null;
}
