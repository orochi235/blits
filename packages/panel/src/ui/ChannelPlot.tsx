import { modelToPlot, Plot2D } from '@weasel-js/ui';
import { hueColor } from './hue.js';
import { insetRange, pathOf, rangeOf, type Series } from './path.js';

export interface ChannelPlotProps {
  label: string;
  times: readonly number[];
  series: readonly Series[];
  playhead: number;
  width?: number;
  height?: number;
}

const LABEL_ROOM = 8; // px kept clear above and below the data so edge tick labels fit

// Carried with the component, so it draws the same in a page, a shadow root, or an app's tree.
const CSS = `
.bp-plot { margin: 0; display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.bp-plot-surface { margin-block-end: calc(var(--wzl-font-size-xs) + 6px); }
.bp-plot-label { font-family: var(--wzl-font-ui); font-size: var(--wzl-font-size-xs); color: var(--wzl-fg-muted); }
.bp-plot-thin, .bp-plot-thick { fill: none; stroke-linejoin: round; }
.bp-plot-thin { stroke-width: 1; opacity: 0.65; }
.bp-plot-thick { stroke-width: 2.5; }
.bp-plot-playhead { stroke: var(--wzl-danger); stroke-width: 1; }
`;

/**
 * Values over time, one line per series, with a playhead: the plot the playground's inspector
 * and the panel both draw.
 */
export function ChannelPlot({
  label,
  times,
  series,
  playhead,
  width = 320,
  height = 90,
}: ChannelPlotProps) {
  const [yMin, yMax] = insetRange(rangeOf(series), LABEL_ROOM, height);
  const xMin = times[0] ?? 0;
  const xMax = Math.max(xMin + 1e-9, times[times.length - 1] ?? 1);
  const range = { xMin, xMax, yMin, yMax };
  const size = { width, height };
  const x = (t: number) => modelToPlot({ x: t, y: yMin }, range, size).x;
  const y = (v: number) => modelToPlot({ x: xMin, y: v }, range, size).y;
  const px = x(Math.min(xMax, Math.max(xMin, playhead)));
  return (
    <figure className="bp-plot">
      <style>{CSS}</style>
      <figcaption className="bp-plot-label">{label}</figcaption>
      <Plot2D
        width={width}
        height={height}
        xRange={[xMin, xMax]}
        yRange={[yMin, yMax]}
        className="bp-plot-surface"
        axes={false}
        xTicks={{ labels: 'outside' }}
        yTicks={{ labels: 'inside' }}
        aria-label={label}
      >
        {series.map((ser) => (
          <path
            key={ser.id}
            className={ser.thick ? 'bp-plot-thick' : 'bp-plot-thin'}
            d={pathOf(times, ser.values, x, y)}
            stroke={ser.color ?? hueColor(ser.hue)}
          />
        ))}
        <line className="bp-plot-playhead" x1={px} x2={px} y1={0} y2={height} />
      </Plot2D>
    </figure>
  );
}
