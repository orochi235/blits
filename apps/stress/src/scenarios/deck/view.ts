import type { Deck } from './build';
import { SLIDE_MS } from './build';

/** The slide the mix clock is on: each of its builds a card sliding in to its `x` as its opacity comes up. */
export function draw(d: Deck, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  d.m.pull(d.elems, { x: d.x, opacity: d.opacity });
  const last = d.builds.at(-1)?.slide ?? 0;
  const slide = Math.max(0, Math.min(last, Math.floor(d.m.now / SLIDE_MS)));
  const mine = d.builds.filter((b) => b.slide === slide);
  const count = mine.length;
  ctx.fillStyle = '#e8eefc';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText(`slide ${slide + 1} of ${last + 1}`, 16, 26);
  const row = (h - 48) / Math.max(count, 1);
  mine.forEach((b, k) => {
    const a = d.opacity[b.i] as number;
    const x = 16 + ((d.x[b.i] as number) / 260) * (w - 220);
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.fillStyle = `hsl(${(b.build * 55 + 200) % 360} 65% 55%)`;
    ctx.fillRect(x, 40 + k * row, 180, Math.min(64, Math.max(4, row - 10)));
    ctx.fillStyle = '#0b0c0f';
    ctx.fillText(`build ${b.build}`, x + 10, 40 + k * row + 22);
  });
  ctx.globalAlpha = 1;
}
