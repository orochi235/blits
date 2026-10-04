import { modelToPlot, Plot2D } from '@weasel-js/ui';
import s from './ChannelPlot.module.css';
import { insetRange, pathOf, rangeOf, type Series } from './path';

export interface ChannelPlotProps {
  label: string;
  times: readonly number[];
  series: readonly Series[];
  playhead: number;
  width?: number;
  height?: number;
}

const LABEL_ROOM = 8; // px kept clear above and below the data so edge tick labels fit

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
    <figure className={s.plot}>
      <figcaption className={s.label}>{label}</figcaption>
      <Plot2D
        width={width}
        height={height}
        xRange={[xMin, xMax]}
        yRange={[yMin, yMax]}
        axes={false}
        xTicks={{ labels: 'inside' }}
        yTicks={{ labels: 'inside' }}
        aria-label={label}
      >
        {series.map((ser) => (
          <path
            key={ser.id}
            className={ser.thick ? s.thick : s.thin}
            d={pathOf(times, ser.values, x, y)}
            stroke={`hsl(${ser.hue} 70% 62%)`}
          />
        ))}
        <line className={s.playhead} x1={px} x2={px} y1={0} y2={height} />
      </Plot2D>
    </figure>
  );
}
