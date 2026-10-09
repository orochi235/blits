import { toHex } from '@msb235/blits';
import type { Composition } from '@pg/blits/composition';
import { ancestorsOf } from '@pg/blits/groups';
import { CHANNELS, type ChannelName, type Mixed } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { ChannelPlot, type Series } from '@pg/widgets/ChannelPlot';
import { useSyncExternalStore } from 'react';
import s from './App.module.css';

const plotted = (pose: Mixed | undefined, ch: ChannelName) =>
  pose === undefined
    ? Number.NaN
    : ch === 'offset'
      ? (pose.offset[1] ?? Number.NaN)
      : ch === 'color'
        ? pose.color === undefined
          ? Number.NaN
          : toHex(pose.color)
        : pose[ch];

export interface InspectorProps {
  player: Player;
  comp: Composition;
}

export function Inspector({ player, comp }: InspectorProps) {
  const { picked, samples: h } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  if (picked === null || h.length === 0)
    return <p className={s.row}>Click a subject on the stage to plot its channels.</p>;
  const doubts = player.doubts();
  const times = h.map((x) => x.t);
  const t = times[times.length - 1] ?? 0;
  // A voice that gave this subject no weight in the window would only draw a flat line at rest.
  const voices = comp.voices.filter((v) => h.some((x) => (x.weights.get(v.id) ?? 0) > 0));
  const groups = [...new Set(voices.flatMap((v) => ancestorsOf(comp, v.id)))];
  const weighed = (xs: readonly { id: string; hue: number }[]): Series[] =>
    xs.map((x) => ({
      id: x.id,
      hue: x.hue,
      values: h.map((y) => y.weights.get(x.id) ?? Number.NaN),
    }));
  return (
    <div className={s.plots}>
      <p className={s.row}>
        subject {picked} · thin: each voice alone · thick: the mix · offset plots y · beside each
        channel, how sure blits is of it now
      </p>
      {CHANNELS.map((ch) => {
        const series: Series[] = voices.map((v) => ({
          id: v.id,
          hue: v.hue,
          values: h.map((x) => plotted(x.solos.get(v.id), ch)),
        }));
        series.push({
          id: 'mix',
          hue: 0,
          color: 'var(--wzl-fg)',
          values: h.map((x) => plotted(x.full, ch)),
          thick: true,
        });
        const label = doubts ? `${ch} · ${doubts[ch]}` : ch;
        return <ChannelPlot key={ch} label={label} times={times} series={series} playhead={t} />;
      })}
      <ChannelPlot label="weightOf" times={times} series={weighed(voices)} playhead={t} />
      {groups.length > 0 && (
        <ChannelPlot
          label="weightOf · their groups"
          times={times}
          series={weighed(groups)}
          playhead={t}
        />
      )}
    </div>
  );
}
