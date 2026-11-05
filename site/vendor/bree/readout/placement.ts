import { type Placement, VIEW } from '../render/placement.js';
import type { Spot } from './layout.js';

/** Where a readout goes, in the canvas's CSS pixels: a box its cells are fitted in, and a clip. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly clip: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

/** A readout as its placement sees it: where its layout put it, and where it should go now. */
export interface Placed {
  spot: Spot;
  readonly slant: number;
  /** Its box this frame, or null where it shows nowhere. */
  box(): Box | null;
}

/** How a surface's canvas is sized and watched. */
export interface Canvas {
  /** Its size in CSS pixels. */
  size(canvas: HTMLCanvasElement): { width: number; height: number };
  /** Calls `resized` whenever its size may have changed; gives a stop. */
  watch(canvas: HTMLCanvasElement, resized: () => void): () => void;
}

/** One view per readout, each fitted in its box with its aspect kept, centered, and clipped. */
export function surfacePlacement(readouts: () => readonly Placed[], sizing: Canvas): Placement {
  let views = new Float32Array(VIEW);
  let target: HTMLCanvasElement | null = null;
  /** Whether the views were filled since the sign last drew them. */
  let stale = false;
  const fill = (): boolean => {
    const list = readouts();
    const next = new Float32Array(Math.max(1, list.length) * VIEW);
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    for (const [v, r] of list.entries()) {
      const box = r.box();
      if (!box) continue;
      const { width, height } = r.spot;
      const slanted = width + height * r.slant;
      const scale = Math.min(box.width / slanted, box.height / height) * dpr;
      if (!(scale > 0)) continue;
      const spare = (span: number, used: number) =>
        Number.isFinite(span) ? (span * dpr - used) / 2 : 0;
      const left = box.x * dpr + spare(box.width, slanted * scale) + height * r.slant * scale;
      const top = box.y * dpr + spare(box.height, height * scale);
      const c = box.clip;
      if (!(c.x1 > c.x0 && c.y1 > c.y0)) continue;
      next.set(
        [left, top, scale, r.slant, c.x0 * dpr, c.y0 * dpr, c.x1 * dpr, c.y1 * dpr],
        v * VIEW,
      );
    }
    const moved = next.length !== views.length || next.some((x, i) => x !== views[i]);
    views = next;
    return moved;
  };
  const self = {
    get views() {
      return views;
    },
    pitch: 0,
    blur: false,
    start(canvas: HTMLCanvasElement, changed: () => void) {
      target = canvas;
      const resized = () => {
        const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
        const { width, height } = sizing.size(canvas);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        fill();
        changed();
      };
      const stop = sizing.watch(canvas, resized);
      resized();
      return () => {
        stop();
        target = null;
      };
    },
    update() {
      const moved = fill() || stale;
      stale = false;
      return moved;
    },
    refit() {
      stale = true;
      if (target) fill();
    },
  };
  return self;
}
