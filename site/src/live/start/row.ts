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
