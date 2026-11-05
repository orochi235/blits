import type { Board, Led } from '../board.js';
import type { SignColumns } from '../draw.js';
import type { Follow, Marquee } from '../marquee-api.js';
import { axesOf } from '../optics.js';
import { PLANES } from '../planes.js';
import { type Drawing, drawingOf } from './attach.js';
import { POSE, SLOT } from './webgpu/wgsl-optics.js';

/** What a marquee lays over its pulled columns: a followed sign's planes, and a highlight. */
export interface Overlay {
  /** Settles how this frame follows, before the pull: on the GPU, or onto the columns. */
  prepare(): void;
  /** Lays the followed sign's planes over the dots, where that happens on the CPU. */
  follow(): void;
  /** Swaps the marked dots' `invert`, where that happens on the CPU. */
  highlight(): void;
  setHighlight(marked: ((dot: Led) => boolean) | null): void;
}

/** Per dot of `b`, the dot at the same place on `sb`. */
function mapOf(b: Board, sb: Board): Uint32Array {
  const map = new Uint32Array(b.dots.length);
  for (let i = 0; i < b.dots.length; i++) {
    const d = b.dots[i] as Led;
    const sx = Math.min(sb.cols - 1, Math.floor(((d.x + 0.5) * sb.cols) / b.cols));
    const sy = Math.min(sb.rows - 1, Math.floor(((d.y + 0.5) * sb.rows) / b.rows));
    map[i] = sy * sb.cols + sx;
  }
  return map;
}

/**
 * The overlay for a marquee drawn by `mine`. A followed sign drawn with WebGPU on the same device
 * is laid on the GPU; one on another device is read back, a frame or so late; any other is copied
 * from its columns. A destroyed source is not followed.
 */
export function createOverlay(
  b: Board,
  cols: SignColumns,
  mine: Drawing,
  self: () => Marquee,
  opts: Follow | undefined,
): Overlay {
  const followed = opts ? opts.planes.flatMap((plane) => PLANES[plane]) : [];
  let from: { source: Marquee; map: Uint32Array } | null = null;
  let mode: 'gpu' | 'poses' | 'columns' | null = null;
  /** The source the WebGPU sign is following on the GPU. */
  let bound: Marquee | null = null;

  let marked: ((dot: Led) => boolean) | null = null;
  /** The invert each marked dot had from the mix, so marking it again doesn't swap it back. */
  let mixed: Float64Array | null = null;

  function highlight(): void {
    if (!marked || mine.webgpu) return;
    mixed = Float64Array.from(cols.invert.subarray(0, b.dots.length));
    for (let i = 0; i < b.dots.length; i++)
      if (marked(b.dots[i] as Led)) cols.invert[i] = 1 - Math.min(1, Math.max(0, mixed[i] ?? 0));
  }

  return {
    prepare() {
      const got = opts?.source() ?? null;
      const source = got && got !== self() ? got : null;
      const theirs = source ? drawingOf(source) : undefined;
      if (!source || theirs?.gone) mode = null;
      else if (mine.webgpu && theirs?.webgpu && theirs.device === mine.device) mode = 'gpu';
      else mode = theirs?.webgpu ? 'poses' : 'columns';
      if (source && from?.source !== source) from = { source, map: mapOf(b, source.board) };
      if (mode === 'gpu' && from && theirs?.webgpu) {
        if (bound !== source)
          mine.webgpu?.setFollow({
            lit: theirs.webgpu.output,
            map: from.map,
            planes: opts?.planes ?? [],
          });
        bound = source;
      } else if (bound) {
        mine.webgpu?.setFollow(null);
        bound = null;
      }
      mine.keep(mode === 'poses' || mode === 'columns' ? followed : []);
    },
    follow() {
      if (!from || (mode !== 'poses' && mode !== 'columns')) return;
      const { source, map } = from;
      if (mode === 'columns') {
        const them = source.columns;
        for (let i = 0; i < map.length; i++) {
          const j = map[i] as number;
          for (const c of followed) {
            const n = axesOf(c);
            for (let k = 0; k < n; k++) cols[c][i * n + k] = them[c][j * n + k] ?? 0;
          }
        }
        return;
      }
      const poses = drawingOf(source)?.poses();
      if (!poses) return;
      for (let i = 0; i < map.length; i++) {
        const j = map[i] as number;
        for (const c of followed) {
          const n = axesOf(c);
          for (let k = 0; k < n; k++) cols[c][i * n + k] = poses[j * POSE + SLOT[c] + k] ?? 0;
        }
      }
    },
    highlight,
    setHighlight(next) {
      marked = next;
      if (mine.webgpu) {
        mine.webgpu.setHighlight(next ? Uint8Array.from(b.dots, (d) => (next(d) ? 1 : 0)) : null);
        return;
      }
      // A held sign won't pull again, so the mix's own invert comes back from what was kept.
      if (mixed) cols.invert.set(mixed);
      mixed = null;
      highlight();
    },
  };
}
