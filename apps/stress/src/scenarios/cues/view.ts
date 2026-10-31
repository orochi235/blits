import { GROUPS, groupOf } from './script';

const GAP = 4;

/** A strip of fixtures: height by level, lit in the cue's hue; the fader group each belongs to runs beneath. */
export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  level: Float64Array,
  hue: Float64Array,
): void {
  const n = level.length;
  const cw = (w - GAP * (n + 1)) / n;
  const top = 8;
  const bottom = h - 22;
  for (let i = 0; i < n; i++) {
    const l = Math.max(0, Math.min(1, level[i] as number));
    const x = GAP + i * (cw + GAP);
    ctx.fillStyle = '#1b1e25';
    ctx.fillRect(x, top, cw, bottom - top);
    ctx.fillStyle = `hsl(${hue[i] as number} 85% ${20 + 45 * l}%)`;
    const bar = (bottom - top) * l;
    ctx.fillRect(x, bottom - bar, cw, bar);
    ctx.fillStyle = `hsl(${(groupOf(i) * 360) / GROUPS} 40% 50%)`;
    ctx.fillRect(x, bottom + 6, cw, 6);
  }
}
