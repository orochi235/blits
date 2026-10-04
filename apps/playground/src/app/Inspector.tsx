import type { Composition } from '@pg/blits/composition';
import { CHANNELS, type ChannelName, type Pose } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { ChannelPlot, type Series } from '@pg/widgets/ChannelPlot';
import { useRef } from 'react';
import s from './App.module.css';

/** How much history each plot keeps, ms of score time. */
const WINDOW = 3000;

interface Sample {
  t: number;
  full: Pose;
  solos: Map<string, Pose>;
  weights: Map<string, number>;
}

const plotted = (pose: Pose | undefined, ch: ChannelName) =>
  pose === undefined ? Number.NaN : ch === 'offset' ? (pose.offset[1] ?? Number.NaN) : pose[ch];

export interface InspectorProps {
  player: Player;
  comp: Composition;
  picked: number | null;
  frame: number;
}

export function Inspector({ player, comp, picked, frame }: InspectorProps) {
  const history = useRef<Sample[]>([]);
  const seen = useRef<{ frame: number; picked: number | null; comp: Composition; player: Player }>(
    null,
  );
  const was = seen.current;
  if (
    !was ||
    was.frame !== frame ||
    was.picked !== picked ||
    was.comp !== comp ||
    was.player !== player
  ) {
    if (!was || was.picked !== picked || was.comp !== comp || was.player !== player)
      history.current = [];
    seen.current = { frame, picked, comp, player };
    const full = picked === null ? undefined : player.probe(null, picked);
    const h = history.current;
    if (picked !== null && full) {
      // Probes write into a pose the mix reuses, so each is copied before the next.
      const solos = new Map<string, Pose>();
      const weights = new Map<string, number>();
      for (const v of comp.voices) {
        const pose = player.probe(v.id, picked);
        if (pose) solos.set(v.id, { ...pose, offset: [...pose.offset] });
        if (player.built.handles.has(v.id)) weights.set(v.id, player.weightOf(v.id, picked));
      }
      if (h.length > 0 && player.t < (h[h.length - 1] as Sample).t) h.length = 0;
      if (h.length > 0 && player.t === (h[h.length - 1] as Sample).t) h.pop();
      h.push({ t: player.t, full: { ...full, offset: [...full.offset] }, solos, weights });
      while (h.length > 0 && (h[0] as Sample).t < player.t - WINDOW) h.shift();
    }
  }

  const h = history.current;
  if (picked === null || h.length === 0)
    return <p className={s.row}>Click a subject on the stage to plot its channels.</p>;
  const times = h.map((x) => x.t);
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
        return (
          <ChannelPlot key={ch} label={ch} times={times} series={series} playhead={player.t} />
        );
      })}
      <ChannelPlot
        label="weightOf"
        times={times}
        series={voices.map((v) => ({
          id: v.id,
          hue: v.hue,
          values: h.map((x) => x.weights.get(v.id) ?? Number.NaN),
        }))}
        playhead={player.t}
      />
    </div>
  );
}
