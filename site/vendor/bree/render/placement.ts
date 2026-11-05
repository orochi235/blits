import { fitCanvas } from './fit.js';

/**
 * Floats per view: `[ox, oy, scale, slant, clipX0, clipY0, clipX1, clipY1]`, in device pixels.
 * Local (x, y) lands at `(ox + (x - y * slant) * scale, oy + y * scale)`; a scale of 0 hides it.
 */
export const VIEW = 8;

/** How a sign sizes its canvas and where each of its views lands on it. */
export interface Placement {
  readonly views: Float32Array;
  /** Device pixels per local unit, for a full-canvas blur; 0 where views differ in scale. */
  readonly pitch: number;
  /** Whether the glow is blurred across the whole canvas, or each primitive blooms by itself. */
  readonly blur: boolean;
  /** Starts sizing `canvas`, calling `changed` after each resize or view change; gives a stop. */
  start(canvas: HTMLCanvasElement, changed: () => void): () => void;
  /** Called each frame before drawing: true where the views moved since the last call. */
  update(): boolean;
  /** Sizes the canvas again now. */
  refit(): void;
}

/** Where local (`x`, `y`) lands on the canvas through view `v`. */
export function toDevice(views: Float32Array, v: number, x: number, y: number): [number, number] {
  const o = v * VIEW;
  const scale = views[o + 2] as number;
  return [
    (views[o] as number) + (x - y * (views[o + 3] as number)) * scale,
    (views[o + 1] as number) + y * scale,
  ];
}

/**
 * A sign `across` × `down` pitches, fitted to its canvas's parent as `fitCanvas` fits it, as one
 * view whose local units are pitches from the sign's top left.
 */
export function boardPlacement(
  across: number,
  down: number,
  want: () => number | undefined,
): Placement {
  const views = new Float32Array(VIEW);
  let fit: { refit(): void; stop(): void } | null = null;
  const self = {
    views,
    pitch: 0,
    blur: true,
    start(canvas: HTMLCanvasElement, changed: () => void) {
      fit = fitCanvas(canvas, across, down, want, (pitch) => {
        self.pitch = pitch;
        views.set([0, 0, pitch, 0, 0, 0, canvas.width, canvas.height]);
        changed();
      });
      return () => fit?.stop();
    },
    update: () => false,
    refit: () => fit?.refit(),
  };
  return self;
}
