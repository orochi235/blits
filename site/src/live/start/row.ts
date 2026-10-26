/** One dot in the row: its button, and where it sits. */
export interface Dot {
  el: HTMLElement;
  index: number;
}

/** Puts a row of `n` dots in `root`, each a button the page styles as `.dot`. */
export function row(root: HTMLElement, n: number): Dot[] {
  const box = document.createElement('div');
  box.className = 'dots';
  root.append(box);
  return Array.from({ length: n }, (_, index) => {
    const el = document.createElement('button');
    el.className = 'dot';
    el.ariaLabel = `Dot ${index + 1}`;
    box.append(el);
    return { el, index };
  });
}

/**
 * Calls `frame` with each animation frame's time while the window has focus, until the returned
 * function stops it. Away, it waits, and on return `m.rebase()` takes the time away off the clock.
 */
export function loop(m: { rebase(): void }, frame: (now: number) => void): () => void {
  let away = !document.hasFocus();
  const tick = (now: number) => {
    frame(now);
    id = requestAnimationFrame(tick);
  };
  // Without focus to begin with, it draws one frame and waits.
  let id = requestAnimationFrame(away ? frame : tick);
  const blur = () => {
    away = true;
    cancelAnimationFrame(id);
  };
  const focus = () => {
    if (!away) return;
    away = false;
    m.rebase();
    id = requestAnimationFrame(tick);
  };
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  return () => {
    cancelAnimationFrame(id);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
  };
}
