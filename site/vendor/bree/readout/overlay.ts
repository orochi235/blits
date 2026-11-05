import type { Surface, SurfaceOptions } from './api.js';
import type { Box, Canvas } from './placement.js';
import { createSurface } from './surface.js';

const STYLE = `.bree-overlay { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }`;
const styled = new WeakSet<Document>();

/** Adds the overlay's stylesheet to `doc` once. */
function style(doc: Document): void {
  if (styled.has(doc)) return;
  styled.add(doc);
  const sheet = doc.createElement('style');
  sheet.textContent = STYLE;
  doc.head.append(sheet);
}

/** The overlay fills the viewport, resized with the window. */
const VIEWPORT: Canvas = {
  size: () => ({ width: innerWidth, height: innerHeight }),
  watch(_canvas, resized) {
    addEventListener('resize', resized);
    return () => removeEventListener('resize', resized);
  },
};

/** Every ancestor of `el` that clips what it holds. */
export function clippers(el: Element): Element[] {
  const out: Element[] = [];
  for (let at = el.parentElement; at; at = at.parentElement) {
    const o = getComputedStyle(at);
    if (o.overflowX !== 'visible' || o.overflowY !== 'visible') out.push(at);
  }
  return out;
}

/** `el`'s box this frame, clipped by `by` and the viewport; null where nothing of it shows. */
export function boxOf(el: Element, by: readonly Element[]): Box | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  let clip = { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
  for (const c of [{ getBoundingClientRect: () => r }, ...by]) {
    const b = c.getBoundingClientRect();
    clip = {
      x0: Math.max(clip.x0, b.left),
      y0: Math.max(clip.y0, b.top),
      x1: Math.min(clip.x1, b.right),
      y1: Math.min(clip.y1, b.bottom),
    };
  }
  if (!(clip.x1 > clip.x0 && clip.y1 > clip.y0)) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height, clip };
}

/**
 * A surface over the whole page: one canvas fixed over the viewport, not taking the pointer, each
 * readout fitted inside the element it `follow`s and clipped where that element's scrolling
 * ancestors clip it. It sits on `parent`, the document's body unless given.
 */
export function createOverlay(
  opts: SurfaceOptions & { readonly parent?: HTMLElement } = {},
): Surface {
  const parent = opts.parent ?? document.body;
  style(parent.ownerDocument);
  const canvas = parent.ownerDocument.createElement('canvas');
  canvas.className = 'bree-overlay';
  parent.append(canvas);
  const surface = createSurface(canvas, opts, VIEWPORT, (o) => {
    const el = o.follow;
    if (!el) return () => null;
    const by = clippers(el);
    return () => boxOf(el, by);
  });
  return {
    ...surface,
    readout: surface.readout,
    backend: surface.backend,
    destroy() {
      surface.destroy();
      canvas.remove();
    },
  };
}
