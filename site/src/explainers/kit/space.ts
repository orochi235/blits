/** A demo the space bar can pause and resume: the element it fills, and what toggles it. */
export interface Toggleable {
  el: Element;
  toggle(): void;
}

const demos = new Set<Toggleable>();

/** Space types, presses or moves these, so a demo never takes it from them. */
const OWNS_SPACE =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="checkbox"], [role="spinbutton"], [role="textbox"], [role="switch"], [role="menuitem"]';

/** How much of `el` shows in the viewport, in square px. */
function shown(el: Element): number {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  const at = event.target;
  if (at instanceof Element && at.closest(OWNS_SPACE)) return;
  let best: Toggleable | null = null;
  let most = 0;
  for (const d of demos) {
    const area = shown(d.el);
    if (area > most) {
      most = area;
      best = d;
    }
  }
  if (best === null) return;
  event.preventDefault();
  best.toggle();
}

/**
 * Lets the space bar pause and resume this demo, when it is the one with the most of itself on
 * screen. Returns a function that lets go.
 */
export function onSpace(demo: Toggleable): () => void {
  if (demos.size === 0) window.addEventListener('keydown', onKey);
  demos.add(demo);
  return () => {
    demos.delete(demo);
    if (demos.size === 0) window.removeEventListener('keydown', onKey);
  };
}
