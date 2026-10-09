import type { Level } from '@pg/blits/composition';
import type { SeekBy } from '@pg/blits/player';
import { Transport as WeaselTransport } from '@weasel-js/ui';
import s from './App.module.css';
import { docOf } from './docs';

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
  /** How a scrub back moves the mixes. */
  seekBy: SeekBy;
  onSeekBy(s: SeekBy): void;
  /** The full mix's own rate: its voices slow while the score's clock runs on. */
  mixRate: number;
  onMixRate(r: number): void;
  /** Whether a live change is in force; the next edit drops it, and a replay back does too. */
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
      <label className={s.level} title={docOf('Mix.seek')}>
        scrub by
        <select value={p.seekBy} onChange={(e) => p.onSeekBy(e.target.value as SeekBy)}>
          <option value="replay">replay from 0</option>
          <option value="seek">mix.seek</option>
        </select>
      </label>
      <label className={s.live}>
        <input type="checkbox" checked={p.live} onChange={(e) => p.onLive(e.target.checked)} />
        live
      </label>
      {p.live && (
        <label className={s.level} title={docOf('Mix.rate')}>
          mix rate
          <input
            type="number"
            min={0}
            step={0.25}
            value={p.mixRate}
            onChange={(e) => {
              const r = e.target.valueAsNumber;
              if (Number.isFinite(r) && r >= 0) p.onMixRate(r);
            }}
          />
        </label>
      )}
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
            ? p.seekBy === 'seek'
              ? 'live changes in force: the next edit drops them; mix.seek replays them'
              : 'live changes in force: the next edit or scrub back drops them'
            : 'live: changes are temporary'}
        </span>
      )}
    </div>
  );
}
