/** One dot on the canvas, in 0..1 across and down. */
export interface Dot {
  x: number;
  y: number;
  /** Distance from the middle, 0..1. */
  r: number;
}

export const COLS = 40;
export const ROWS = 12;
const HEIGHT = 260;

/** A canvas in `root` with a `COLS` × `ROWS` grid of dots, and where the pointer is over it. */
export function field(root: HTMLElement) {
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const ctx = canvas.getContext('2d');

  const dots: Dot[] = [];
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const x = (i + 0.5) / COLS;
      const y = (j + 0.5) / ROWS;
      dots.push({ x, y, r: Math.hypot(x - 0.5, (y - 0.5) * 0.4) / 0.55 });
    }

  // Off the canvas, the pointer is at (-1, -1), far from every dot.
  const pointer = { x: -1, y: -1 };
  const moved: (() => void)[] = [];
  const at = (x: number, y: number) => {
    pointer.x = x;
    pointer.y = y;
    for (const f of moved) f();
  };
  canvas.addEventListener('pointermove', (e) => {
    const box = canvas.getBoundingClientRect();
    at((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
  });
  canvas.addEventListener('pointerleave', () => at(-1, -1));

  let width = 0;
  return {
    dots,
    pointer,
    /** Calls `f` whenever the pointer moves. */
    onPointer: (f: () => void) => moved.push(f),
    /** Clears the canvas for a new frame. */
    clear() {
      if (ctx === null) return;
      width = canvas.clientWidth;
      canvas.width = width * devicePixelRatio;
      canvas.height = HEIGHT * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.fillStyle = getComputedStyle(root).color;
    },
    /** Draws one dot, raised by `lift` and as faint as `alpha`, with radius `size`. */
    dot(dot: Dot, lift: number, size: number, alpha: number) {
      if (ctx === null) return;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(dot.x * width, dot.y * HEIGHT - lift, size, 0, 2 * Math.PI);
      ctx.fill();
    },
  };
}
