import type { Doubt } from '@msb235/blits';
import { type Composition, isMotion } from '@pg/blits/composition';
import type { Player } from '@pg/blits/player';
import type { Subject } from '@pg/blits/stage';
import { useState } from 'react';
import { AimField } from './AimField';
import s from './App.module.css';
import { docOf } from './docs';
import { FadeControls } from './FadeControls';

export interface LivePanelProps {
  player: Player;
  comp: Composition;
  /** The voice's or group's id. */
  id: string;
  /** The subject picked on the stage. */
  subject: Subject | undefined;
  /** Called after each live change, so the panel and the badge redraw. */
  onActed(): void;
}

export function LivePanel({ player, comp, id, subject, onActed }: LivePanelProps) {
  const [seekMs, setSeekMs] = useState(0);
  const [keep, setKeep] = useState(false);
  const [doubt, setDoubt] = useState<Doubt | null>(null);
  const [rateTo, setRateTo] = useState(1);
  const [rampTo, setRampTo] = useState(0.25);
  const [rampOver, setRampOver] = useState(500);
  const v = comp.voices.find((x) => x.id === id);
  const name = (v ?? comp.groups?.find((g) => g.id === id))?.name ?? id;
  const handle = player.handleOf(id);
  if (!handle) return <p className={s.row}>{name} is not running: fix its errors first.</p>;
  const act: Player['live'] = (at, fn) => {
    player.live(at, fn);
    onActed();
  };
  return (
    <section className={s.panel} aria-label={`live ${name}`}>
      <p className={s.row}>
        live · {name} · {handle.state}
      </p>
      <label className={s.row} title={docOf('Handle.weight')}>
        weight
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={handle.weight}
          onChange={(e) => {
            const w = Number(e.target.value);
            // Elsewhere a voice plays silent beside another's solo, and must stay so.
            act(id, (h, _, heard) => {
              if (heard) h.weight = w;
            });
          }}
        />
        <output className={s.readout}>{handle.weight.toFixed(2)}</output>
      </label>
      <FadeControls subject={subject} whole={!v} act={(fn) => act(id, fn)} />
      <div className={s.row}>
        <label className={s.row} title={docOf('Handle.seek')}>
          seek
          <input
            type="number"
            min={0}
            step="any"
            value={seekMs}
            onChange={(e) => setSeekMs(e.target.valueAsNumber || 0)}
          />
        </label>
        <label className={s.row}>
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          keep state
        </label>
        <button
          type="button"
          onClick={() =>
            act(id, (h, _, heard) => {
              const d = h.seek(seekMs, keep ? { state: 'keep' } : {});
              if (heard) setDoubt(d);
            })
          }
        >
          go
        </button>
        {doubt && (
          <output className={s.readout} title={docOf('Handle.seek')}>
            {doubt}
          </output>
        )}
      </div>
      <div className={s.row} title={docOf('Handle.rate')}>
        <label className={s.row}>
          rate
          <input
            type="number"
            min={0}
            step="any"
            value={rateTo}
            onChange={(e) => setRateTo(e.target.valueAsNumber || 0)}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            act(id, (h) => {
              h.rate = rateTo;
            })
          }
        >
          set
        </button>
        <output className={s.readout}>now {handle.rate.toFixed(2)}</output>
      </div>
      <div className={s.row} title={docOf('Handle.ramp')}>
        <label className={s.row}>
          ramp to
          <input
            type="number"
            min={0}
            step="any"
            value={rampTo}
            onChange={(e) => setRampTo(e.target.valueAsNumber || 0)}
          />
        </label>
        <label className={s.row}>
          over
          <input
            type="number"
            min={0}
            step="any"
            value={rampOver}
            onChange={(e) => setRampOver(e.target.valueAsNumber || 0)}
          />
        </label>
        <button type="button" onClick={() => act(id, (h) => h.ramp(rampTo, rampOver))}>
          ramp
        </button>
      </div>
      {v && isMotion(v.patch) && (
        <AimField comp={comp} player={player} id={id} patch={v.patch} act={act} />
      )}
    </section>
  );
}
