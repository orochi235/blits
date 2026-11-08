import type { Level } from '@pg/blits/composition';
import type { SeekBy } from '@pg/blits/player';
import { Glyph } from '@pg/widgets/Glyph';
import { Button, PropertyField, Transport as WeaselTransport } from '@weasel-js/ui';
import s from './App.module.css';
import { docOf } from './docs';
import { LiveMix } from './LiveMix';
import { msWide } from './ms';

const SEEK_BY: { value: SeekBy; label: string }[] = [
  { value: 'replay', label: 'replay from 0' },
  { value: 'seek', label: 'mix.seek' },
];

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
  /** Moves the playhead by whole frames. */
  onStep(frames: number): void;
  /** The full mix's clock and frame number, shown while a scrub back goes by `mix.seek`. */
  clock: { now: number; seq: number };
  /** The full mix's own rate: its voices slow while the score's clock runs on. */
  mixRate: number;
  /** Sets the full mix's rate, or ramps it there over `over` ms. */
  onMixRate(r: number, over: number | undefined): void;
  /** Fades every voice out, over `over` ms or each voice's own `fade.out`. */
  onMute(over: number | undefined): void;
  /** Whether a live change is in force; the next edit drops it, and a replay back does too. */
  livened: boolean;
  levels: readonly Level[];
  /** Slider values in force; a level absent here shows the composition's value. */
  moved: ReadonlyMap<string, number>;
  onLevel(name: string, v: number): void;
  /** Whether the score's lanes are open, or closed to thin strips. */
  tracksOpen: boolean;
  onTracks(): void;
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
      <PropertyField
        hug
        layout="inline"
        label="scrub by"
        description={docOf('Mix.seek')}
        kind="enum"
        value={p.seekBy}
        options={SEEK_BY}
        onChange={p.onSeekBy}
      />
      <span className={s.level}>
        <Button iconOnly variant="ghost" ariaLabel="back one frame" onClick={() => p.onStep(-1)}>
          <Glyph name="ui:stepBack" />
        </Button>
        <Button iconOnly variant="ghost" ariaLabel="forward one frame" onClick={() => p.onStep(1)}>
          <Glyph name="ui:stepForward" />
        </Button>
      </span>
      <Button onClick={p.onTracks}>{p.tracksOpen ? 'Hide tracks' : 'Show tracks'}</Button>
      {p.seekBy === 'seek' && (
        <span className={s.clock} title={docOf('Mix.seq')}>
          mix {msWide(p.clock.now)} · frame {String(p.clock.seq).padStart(5)}
        </span>
      )}
      <PropertyField
        hug
        layout="inline"
        label="live"
        kind="boolean"
        control="switch"
        value={p.live}
        onChange={p.onLive}
      />
      {p.live && <LiveMix rate={p.mixRate} onRate={p.onMixRate} onMute={p.onMute} />}
      {p.levels.map((l) => (
        <PropertyField
          key={l.name}
          hug
          layout="inline"
          label={l.name}
          kind="number"
          control="slider"
          min={l.min}
          max={l.max}
          step={(l.max - l.min) / 200}
          value={p.moved.get(l.name) ?? l.value}
          onInput={(v) => p.onLevel(l.name, v)}
          onChange={(v) => p.onLevel(l.name, v)}
        />
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
