import type { Surface, SurfaceOptions } from './api.js';
import type { Canvas } from './placement.js';
import { createSurface } from './surface.js';

/** A panel's canvas fills its own CSS box. */
const PANEL: Canvas = {
  size: (canvas) => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
  watch(canvas, resized) {
    const watch = new ResizeObserver(resized);
    watch.observe(canvas);
    return () => watch.disconnect();
  },
};

/**
 * A surface drawing every readout on `canvas`, each at its `at` and `height` in the canvas's CSS
 * pixels. The canvas keeps the size the page gives it.
 */
export function createPanel(canvas: HTMLCanvasElement, opts: SurfaceOptions = {}): Surface {
  return createSurface(canvas, opts, PANEL, (o, c) => {
    const at = o.at ?? { x: 0, y: 0 };
    const height = o.height ?? 48;
    return () => ({
      x: at.x,
      y: at.y,
      width: Number.POSITIVE_INFINITY,
      height,
      clip: { x0: 0, y0: 0, x1: c.clientWidth, y1: c.clientHeight },
    });
  });
}
