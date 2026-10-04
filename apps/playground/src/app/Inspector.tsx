import type { Composition } from '@pg/blits/composition';
import { CHANNELS, type ChannelName, type Pose } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { ChannelPlot, type Series } from '@pg/widgets/ChannelPlot';
import { useSyncExternalStore } from 'react';
import s from './App.module.css';

const plotted = (pose: Pose | undefined, ch: ChannelName) =>
  pose === undefined ? Number.NaN : ch === 'offset' ? (pose.offset[1] ?? Number.NaN) : pose[ch];

export interface InspectorProps {
  player: Player;
  comp: Composition;
}

export function Inspector({ player, comp }: InspectorProps) {
  const { picked, samples: h } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  if (picked === null || h.length === 0)
    return <p className={s.row}>Click a subject on the stage to plot its channels.</p>;
  const times = h.map((x) => x.t);
  const t = times[times.length - 1] ?? 0;
  // A voice that gave this subject no weight in the window would only draw a flat line at rest.
  const voices = comp.voices.filter((v) => h.some((x) => (x.weights.get(v.id) ?? 0) > 0));
  return (
    <div className={s.plots}>
      <p className={s.row}>
        subject {picked} · thin: each voice alone · thick: the mix · offset plots y
      </p>
      {CHANNELS.map((ch) => {
        const series: Series[] = voices.map((v) => ({
          id: v.id,
          hue: v.hue,
          values: h.map((x) => plotted(x.solos.get(v.id), ch)),
        }));
        series.push({ id: 'mix', hue: 0, values: h.map((x) => plotted(x.full, ch)), thick: true });
        return <ChannelPlot key={ch} label={ch} times={times} series={series} playhead={t} />;
      })}
      <ChannelPlot
        label="weightOf"
        times={times}
        series={voices.map((v) => ({
          id: v.id,
          hue: v.hue,
          values: h.map((x) => x.weights.get(v.id) ?? Number.NaN),
        }))}
        playhead={t}
      />
    </div>
  );
}
