import { useMemo } from 'react';
import type { MarkInfo, VoiceInfo } from '../protocol.js';
import type { Samples } from '../store.js';
import { ChannelPlot } from './ChannelPlot.js';
import { voiceHue } from './hue.js';
import { axisOf } from './lanes.js';
import { Plan } from './Plan.js';
import type { Series } from './path.js';

/** The plan, then the picked subject's channels and the voices' weights on it, on one time axis. */
export function Plots({
  samples,
  drawn,
  voices,
  marks,
  playhead,
  picked,
  mix,
}: {
  samples: Samples;
  drawn: number;
  voices: VoiceInfo[];
  marks: MarkInfo[];
  playhead: number;
  picked: boolean;
  mix: boolean;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` says the samples changed
  const series = useMemo(() => samples.series(), [samples, drawn]);
  const { times, values, weights, read } = series;
  const head = Number.isFinite(playhead) ? playhead : (times[times.length - 1] ?? Number.NaN);
  const range = axisOf(head, picked ? times : [], marks);
  const plan = mix && <Plan marks={marks} voices={voices} range={range} playhead={head} />;
  if (!picked)
    return (
      <div className="bp-plots">
        {plan}
        <p className="bp-muted">Pick a subject to plot its channels.</p>
      </div>
    );
  const unread = read[read.length - 1] === true ? ' · read, not shown' : '';
  const names = new Map(voices.map((v) => [v.id, v.name ?? `#${v.id}`]));
  const weighed: Series[] = [...weights].map(([id, w]) => ({
    id: names.get(id) ?? `#${id}`,
    hue: voiceHue(id),
    values: w,
  }));
  return (
    <div className="bp-plots">
      {plan}
      {[...values].map(([key, v]) => (
        <ChannelPlot
          key={key}
          label={`${key}${unread}`}
          times={times}
          range={range}
          playhead={head}
          series={[{ id: key, hue: 0, color: 'var(--wzl-fg)', values: v, thick: true }]}
        />
      ))}
      {weighed.length > 0 && (
        <ChannelPlot
          label="weightOf"
          times={times}
          range={range}
          playhead={head}
          series={weighed}
        />
      )}
    </div>
  );
}
