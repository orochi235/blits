import type { Level } from '@pg/blits/composition';
import { Transport as WeaselTransport } from '@weasel-js/ui';
import s from './App.module.css';

export interface TransportProps {
  playing: boolean;
  onPlaying(p: boolean): void;
  rate: number;
  onRate(r: number): void;
  loop: boolean;
  onLoop(l: boolean): void;
  t: number;
  length: number;
  live: boolean;
  onLive(l: boolean): void;
  /** Whether a live change is in force; the next edit or seek back drops it. */
  livened: boolean;
  levels: readonly Level[];
  /** Slider values in force; a level absent here shows the composition's value. */
  moved: ReadonlyMap<string, number>;
  onLevel(name: string, v: number): void;
}

export function Transport(p: TransportProps) {
  return (
    <div className={s.transport}>
      <WeaselTransport
        paused={!p.playing}
        loop={p.loop}
        rate={p.rate}
        playhead={p.t}
        duration={p.length}
        onPlay={() => p.onPlaying(true)}
        onPause={() => p.onPlaying(false)}
        onLoopChange={(l) => p.onLoop(l !== false && l !== 0)}
        onRateChange={p.onRate}
      />
      <label className={s.live}>
        <input type="checkbox" checked={p.live} onChange={(e) => p.onLive(e.target.checked)} />
        live
      </label>
      {p.levels.map((l) => (
        <label key={l.name} className={s.level}>
          {l.name}
          <input
            type="range"
            min={l.min}
            max={l.max}
            step={(l.max - l.min) / 200}
            value={p.moved.get(l.name) ?? l.value}
            onChange={(e) => p.onLevel(l.name, Number(e.target.value))}
          />
        </label>
      ))}
      {(p.live || p.livened) && (
        <span className={s.badge} role="status">
          {p.livened
            ? 'live changes in force: the next edit or scrub back drops them'
            : 'live: changes are temporary'}
        </span>
      )}
    </div>
  );
}
