import { toHex } from '@msb235/blits';
import type { Board, Led } from './board';

/** How long a dot takes to light and to go dark: a filament warms fast and cools slowly. */
const RISE_MS = 12;
const FALL_MS = 110;
/** The margin round the dots, in pitches, which holds the border's bulbs. */
const MARGIN = 3;

export interface Sign {
  /** Draws one frame from the mix's columns, `dt` ms after the last. */
  render(lit: Float64Array, tint: Float64Array, fallback: number, dt: number): void;
}

const hexCss = new Map<number, string>();
function css(hex: number): string {
  let s = hexCss.get(hex);
  if (s === undefined) {
    s = `#${hex.toString(16).padStart(6, '0')}`;
    hexCss.set(hex, s);
  }
  return s;
}

/** A sign drawn on `canvas`, each of `leds` at its place; the mix's columns arrive in that order. */
export function createSign(canvas: HTMLCanvasElement, b: Board, leds: readonly Led[]): Sign {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const glow = document.createElement('canvas');
  const gctx = glow.getContext('2d') as CanvasRenderingContext2D;
  const housing = document.createElement('canvas');
  const shown = new Float64Array(leds.length);
  let pitch = 0;

  const box = canvas.parentElement as HTMLElement;
  const across = b.cols + 2 * MARGIN;
  const down = b.rows + 2 * MARGIN;

  /** Fits the sign in its box, as large as both of the box's sides allow. */
  function resize(): void {
    const css = Math.min(box.clientWidth / across, box.clientHeight / down);
    canvas.style.width = `${Math.floor(css * across)}px`;
    canvas.style.height = `${Math.floor(css * down)}px`;
    pitch = css * devicePixelRatio;
    for (const c of [canvas, glow, housing]) {
      c.width = Math.round(pitch * across);
      c.height = Math.round(pitch * down);
    }
    const hctx = housing.getContext('2d') as CanvasRenderingContext2D;
    hctx.fillStyle = '#0d0a08';
    hctx.fillRect(0, 0, housing.width, housing.height);
    for (const led of leds) {
      const [x, y] = place(led);
      hctx.fillStyle = led.kind === 'bulb' ? '#2b2118' : '#21150f';
      hctx.beginPath();
      hctx.arc(x, y, radius(led), 0, Math.PI * 2);
      hctx.fill();
    }
  }

  const place = (led: Led): [number, number] => [
    (led.x + MARGIN + 0.5) * pitch,
    (led.y + MARGIN + 0.5) * pitch,
  ];
  const radius = (led: Led) => pitch * (led.kind === 'bulb' ? 0.42 : 0.36);

  new ResizeObserver(resize).observe(box);
  resize();

  const pose = new Float64Array(4);
  return {
    render(lit, tint, fallback, dt) {
      const rise = 1 - Math.exp(-dt / RISE_MS);
      const fall = 1 - Math.exp(-dt / FALL_MS);
      gctx.clearRect(0, 0, glow.width, glow.height);
      for (let i = 0; i < leds.length; i++) {
        const want = lit[i] ?? 0;
        const target = want > 0 ? Math.min(want, 1) : 0;
        const was = shown[i] ?? 0;
        const now = was + (target - was) * (target > was ? rise : fall);
        shown[i] = now;
        if (now < 0.02) continue;
        const led = leds[i] as Led;
        for (let k = 0; k < 4; k++) pose[k] = tint[i * 4 + k] ?? 0;
        const hex = (pose[3] ?? 0) > 0 ? toHex(pose) : fallback;
        const [x, y] = place(led);
        const r = radius(led);
        gctx.globalAlpha = now;
        gctx.fillStyle = css(hex);
        gctx.beginPath();
        gctx.arc(x, y, r, 0, Math.PI * 2);
        gctx.fill();
        gctx.globalAlpha = now * 0.55;
        gctx.fillStyle = '#fff4e0';
        gctx.beginPath();
        gctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        gctx.fill();
      }
      gctx.globalAlpha = 1;

      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.drawImage(housing, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${(pitch * 0.9).toFixed(1)}px)`;
      ctx.drawImage(glow, 0, 0);
      ctx.filter = 'none';
      ctx.drawImage(glow, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
