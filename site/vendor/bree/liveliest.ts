import { shownLit, signColumns } from './draw.js';
import { createMarquee } from './marquee.js';
import type { MarqueeOptions } from './marquee-api.js';
import type { Ticker } from './ticker.js';

/** How many moments of the pass are weighed, at least. */
const SAMPLES = 24;
/** The longest step between them, ms: a longer gap reads to the marquee as the page coming back. */
const STEP_MS = 200;

/**
 * The moment of a pass, ms, that best shows its effect at work: the one whose dots differ most
 * from the fullest frame while still lighting a good share of them, so a still reads as the
 * effect rather than the plain message. A pass that never changes gives 0.
 */
export function liveliest(opts: Omit<MarqueeOptions, 'ticker' | 'draw' | 'fade'>): number {
  let tick = null as ((now: number) => void) | null;
  const ticker: Ticker = {
    add(fn) {
      tick = fn;
      return () => {
        tick = null;
      };
    },
    get size() {
      return tick ? 1 : 0;
    },
  };
  const m = createMarquee({ id: '' } as HTMLCanvasElement, {
    ...opts,
    ticker,
    draw: false,
    fade: { rise: 0, fall: 0 },
    name: 'liveliest',
  });
  try {
    const length = m.pass()?.length ?? 0;
    if (length === 0) return 0;
    const n = m.board.dots.length;
    const cols = signColumns(n);
    const frames: { at: number; lit: Float64Array; sum: number }[] = [];
    // The pass plays forward a step a frame: a seek would cue it afresh every time.
    const count = Math.max(SAMPLES, Math.ceil(length / STEP_MS));
    tick?.(0);
    for (let k = 0; k < count; k++) {
      const at = (length * (k + 0.5)) / count;
      tick?.(at);
      m.mix.pull(m.board.dots, cols);
      const lit = new Float64Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        lit[i] = shownLit(cols.lit[i] ?? 0, cols.invert[i] ?? 0) * (cols.gain[i] ?? 1);
        sum += lit[i] ?? 0;
      }
      frames.push({ at, lit, sum });
    }
    const full = frames.reduce((a, b) => (b.sum > a.sum ? b : a));
    if (full.sum === 0) return 0;
    let best = { at: 0, score: 0 };
    for (const f of frames) {
      let off = 0;
      for (let i = 0; i < n; i++) off += Math.abs((f.lit[i] ?? 0) - (full.lit[i] ?? 0));
      const score = (off / full.sum) * Math.min(1, f.sum / full.sum);
      if (score > best.score) best = { at: f.at, score };
    }
    return best.at;
  } finally {
    m.destroy();
  }
}
