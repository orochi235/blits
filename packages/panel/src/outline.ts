/** The box drawn over a subject on the page while it is hovered or picked from. */
export class Outline {
  el: HTMLDivElement | null = null;

  show(rect: DOMRect | undefined): void {
    if (rect === undefined) {
      this.el?.remove();
      this.el = null;
      return;
    }
    if (this.el === null) {
      this.el = document.createElement('div');
      this.el.setAttribute('data-blits-panel', 'outline');
      Object.assign(this.el.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483647',
        border: '2px solid #e0457b',
        borderRadius: '2px',
        boxSizing: 'border-box',
      });
      document.body.appendChild(this.el);
    }
    Object.assign(this.el.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
}
