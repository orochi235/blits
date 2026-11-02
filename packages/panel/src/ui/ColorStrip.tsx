import { modelToPlot } from '@weasel-js/ui';
import { useId } from 'react';

export interface ColorStripProps {
  label: string;
  times: readonly number[];
  /** Each sample's colors: the one shown, then an ordered blend mode's layers, bottom first. */
  colors: readonly (readonly string[] | undefined)[];
  playhead: number;
  /** The span of time drawn; the samples' own span otherwise. */
  range?: readonly [number, number];
  width?: number;
}

const SHOWN = 22;
const LAYER = 9;
const GAP = 2;

// Carried with the component, so it draws the same in a page, a shadow root, or an app's tree.
const CSS = `
.bp-strip { margin: 0 0 6px; display: grid; gap: 2px; }
.bp-strip-label { font-family: var(--wzl-font-ui); font-size: var(--wzl-font-size-xs); color: var(--wzl-fg-muted); }
.bp-strip-check-a { fill: var(--wzl-surface-sunken); }
.bp-strip-check-b { fill: var(--wzl-border); }
.bp-strip-playhead { stroke: var(--wzl-danger); stroke-width: 1; }
.bp-strip-layer-label { font-family: var(--wzl-font-ui); font-size: 8px; fill: var(--wzl-fg-muted); }
`;

/**
 * A color channel over time: a band painted with the color it shows at each sample, over a
 * checkerboard so its opacity reads, and a thin band per layer of an ordered blend mode beneath.
 */
export function ColorStrip({
  label,
  times,
  colors,
  playhead,
  range: span,
  width = 320,
}: ColorStripProps) {
  const check = `bp-check${useId().replace(/[^\w-]/g, '')}`;
  const layers = colors.reduce((n, c) => Math.max(n, (c?.length ?? 1) - 1), 0);
  const height = SHOWN + layers * (LAYER + GAP);
  const xMin = span?.[0] ?? times[0] ?? 0;
  const xMax = Math.max(xMin + 1e-9, span?.[1] ?? times[times.length - 1] ?? 1);
  const range = { xMin, xMax, yMin: 0, yMax: 1 };
  const x = (t: number) => modelToPlot({ x: t, y: 0 }, range, { width, height }).x;
  const px = x(Math.min(xMax, Math.max(xMin, playhead)));
  const row = (j: number) =>
    j === 0 ? { y: 0, h: SHOWN } : { y: SHOWN + (j - 1) * (LAYER + GAP) + GAP, h: LAYER };
  const bands = Array.from({ length: layers + 1 }, (_, j) => ({
    name: j === 0 ? 'shown' : `layer ${j}`,
    layer: j,
    ...row(j),
  }));
  const cells: { key: string; x: number; w: number; y: number; h: number; fill: string }[] = [];
  times.forEach((t, i) => {
    const c = colors[i];
    if (c === undefined) return;
    const x0 = x(t);
    const x1 = i + 1 < times.length ? x(times[i + 1] as number) : x0 + 1;
    if (x1 <= 0 || x0 >= width) return;
    c.forEach((fill, j) => {
      const { y, h } = row(j);
      cells.push({ key: `${i}:${j}`, x: x0, w: Math.max(1, x1 - x0 + 0.5), y, h, fill });
    });
  });
  return (
    <figure className="bp-strip">
      <style>{CSS}</style>
      <figcaption className="bp-strip-label">{label}</figcaption>
      <svg width={width} height={height} role="img" aria-label={label}>
        <defs>
          <pattern id={check} width={8} height={8} patternUnits="userSpaceOnUse">
            <rect className="bp-strip-check-a" width={8} height={8} />
            <rect className="bp-strip-check-b" width={4} height={4} />
            <rect className="bp-strip-check-b" x={4} y={4} width={4} height={4} />
          </pattern>
        </defs>
        {bands.map((b) => (
          <rect key={b.name} y={b.y} width={width} height={b.h} fill={`url(#${check})`} />
        ))}
        {cells.map((c) => (
          <rect key={c.key} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} />
        ))}
        {bands.slice(1).map((b) => (
          <text key={b.name} className="bp-strip-layer-label" x={2} y={b.y + LAYER - 1}>
            {b.layer}
          </text>
        ))}
        <line className="bp-strip-playhead" x1={px} x2={px} y1={0} y2={height} />
      </svg>
    </figure>
  );
}
