import { board } from './board.js';
import { AMBER } from './color.js';
import type { EffectSpec } from './effects.js';
import { type Look, ROWS, rasterize } from './font.js';
import { liveliest } from './liveliest.js';
import { createMarquee } from './marquee.js';
import type { Follow, Marquee } from './marquee-api.js';
import { rowsToShow } from './orders.js';
import type { Backend } from './render/backend.js';
import type { Gpu } from './render/gpu.js';
import { createTicker, type Ticker } from './ticker.js';

export interface ThumbnailOptions extends Look {
  /** The effect it loops: a built-in's name, one of `effects`, or a spec. */
  readonly effect: string | EffectSpec;
  /** Effects `effect` can name, ahead of the built-ins. */
  readonly effects?: Readonly<Record<string, EffectSpec>>;
  /** The message. Default `OPEN`, which fits the default board in every face. */
  readonly text?: string;
  /** Its color. Default amber. */
  readonly hex?: number;
  /** Dots across and down. Default 32 across and as many rows as show every dot of the text, at least 7. */
  readonly cols?: number;
  readonly rows?: number;
  /** False leaves the housing see-through, so the page shows between the dots. Default true. */
  readonly housing?: boolean;
  /**
   * A sign whose planes it wears, as `createMarquee` takes it. Held, it then stays on the ticker
   * repainting the moment it holds, without running its mix, so it follows a moving sign.
   */
  readonly follow?: Follow;
  /** A WebGPU device from `gpu()`, as `createMarquee` takes it. Default none. */
  readonly gpu?: Gpu | null;
  /** What it draws with, as `createMarquee` takes it. */
  readonly backend?: Backend;
  /** The clock it animates on. Default one every thumbnail shares, at 30 fps. */
  readonly ticker?: Ticker;
  /**
   * A moment of the pass to draw once and hold, for a still preview instead of a loop: ms, or
   * `'action'` for the one that best shows the effect at work (`liveliest`).
   */
  readonly still?: number | 'action';
}

export interface Thumbnail {
  /** The sign it plays on, for `setProgram` and `setEffects` when the effect changes. */
  readonly marquee: Marquee;
  /** Whether it is animating: false while held or scrolled out of view. */
  readonly playing: boolean;
  /**
   * Plays on from the moment it shows, or holds the moment it has reached, or `at`: a moment in
   * ms, or `'still'` for the one it was made to show. A still starts held.
   */
  play(on: boolean, at?: number | 'still'): void;
  /** Stops it, lets go of the canvas, and takes its mix off the debuggers' list. */
  destroy(): void;
}

/** Action moments already found, by the sign they were found for; the oldest go past `KEEP`. */
const moments = new Map<string, number>();
const KEEP = 500;
const remember = (key: string, at: number) => {
  moments.set(key, at);
  for (const old of moments.keys()) {
    if (moments.size <= KEEP) break;
    moments.delete(old);
  }
};
/** Searches waiting their turn: one per task, so a strip of stills fills in without a stall. */
let queue = Promise.resolve();
const later = (fn: () => void) => {
  queue = queue.then(
    () =>
      new Promise<void>((done) =>
        setTimeout(() => {
          try {
            fn();
          } finally {
            done();
          }
        }, 0),
      ),
  );
};

let shared: Ticker | undefined;
/** The ticker thumbnails share by default, made at first use. */
const thumbnails = () => {
  shared ??= createTicker({ fps: 30 });
  return shared;
};

/**
 * A small sign on `canvas` looping one effect, for a preview: no layers, no border. It
 * animates only while the canvas is in view, on a ticker shared with every other thumbnail.
 */
export function createThumbnail(canvas: HTMLCanvasElement, opts: ThumbnailOptions): Thumbnail {
  const inner = opts.ticker ?? thumbnails();
  let tick: ((now: number) => void) | null = null;
  let off: (() => void) | null = null;
  let visible = true;
  const gate = () => {
    if (visible && tick && !off) off = inner.add(tick);
    else if ((!visible || !tick) && off) {
      off();
      off = null;
    }
  };
  // Still, a thumbnail leaves the ticker once it has drawn onto a canvas with a size; sizing the
  // canvas clears it, so a resize draws it again.
  let redraw: (() => void) | null = null;
  let frame: ((now: number) => void) | null = null;
  /** Whether it is holding one moment, drawn once, rather than looping. */
  let held = opts.still !== undefined;
  // The marquee's frame loop runs through this, so scrolling out of view takes it off the ticker.
  const gated: Ticker = {
    add(fn) {
      frame = fn;
      const once = (now: number) => {
        fn(now);
        if (canvas.width === 0) return;
        // The callback on the ticker changes, so the old one comes off first.
        off?.();
        off = null;
        tick = opts.follow ? repaint : null;
        gate();
      };
      redraw = () => {
        tick = once;
        gate();
      };
      tick = held ? once : fn;
      gate();
      return () => {
        tick = null;
        gate();
      };
    },
    get size() {
      return inner.size;
    },
  };

  const name = typeof opts.effect === 'string' ? opts.effect : opts.effect.name;
  const cols = opts.cols ?? 32;
  const text = opts.text ?? 'OPEN';
  const rows = opts.rows ?? rowsToShow(board(cols, ROWS, false), rasterize(text, opts));
  const sign = {
    cols,
    rows,
    border: false as const,
    effects: opts.effects,
    program: [
      {
        effect: opts.effect,
        text,
        hex: opts.hex ?? AMBER,
        face: opts.face,
        style: opts.style,
      },
    ],
  };
  const marquee = createMarquee(canvas, {
    ...sign,
    housing: opts.housing,
    follow: opts.follow,
    gpu: opts.gpu,
    backend: opts.backend,
    ticker: gated,
    name: `thumbnail ${name}`,
  });

  const repaint = () => marquee.repaint();
  let gone = false;
  /** The moment it was made to show, once known. */
  let rest = typeof opts.still === 'number' ? opts.still : undefined;
  if (opts.still === 'action') {
    const key = JSON.stringify(sign);
    const known = moments.get(key);
    rest = known;
    if (known !== undefined) marquee.seek(known, { hold: true });
    else
      later(() => {
        if (gone) return;
        const at = liveliest(sign);
        remember(key, at);
        rest = at;
        // Played before the search came back, it plays on from where it got to.
        if (!held) return;
        marquee.seek(at, { hold: true });
        redraw?.();
      });
  } else if (opts.still !== undefined) marquee.seek(opts.still, { hold: true });
  if (opts.still !== undefined) {
    // One frame is all a still gets, and a frame after a long wait counts no time, so the dots'
    // warm-up would leave them dark.
    marquee.setFade({ rise: 0, fall: 0 });
  }
  const resized =
    opts.still === undefined || typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => redraw?.());
  // The sign resizes, and so clears, its canvas when this box changes, its first layout included.
  resized?.observe(canvas.parentElement ?? canvas);

  const watch =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          const last = entries[entries.length - 1];
          if (!last) return;
          visible = last.isIntersecting;
          gate();
        });
  watch?.observe(canvas);

  const handle: Thumbnail = {
    marquee,
    play(on, at) {
      if (on === !held && at === undefined) return;
      held = !on;
      const to = at === 'still' ? rest : at;
      marquee.seek(to ?? marquee.pass()?.at ?? 0, { hold: held });
      // The callback on the ticker changes, so the old one comes off first.
      off?.();
      off = null;
      if (held) redraw?.();
      else {
        tick = frame;
        gate();
      }
    },
    get playing() {
      return off !== null && !held;
    },
    destroy() {
      gone = true;
      watch?.disconnect();
      resized?.disconnect();
      marquee.destroy();
    },
  };
  return handle;
}
