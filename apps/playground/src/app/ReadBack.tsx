import { ChannelPlot } from '@msb235/blits-panel';
import { FRAME } from '@pg/blits/frame';
import { CHANNELS, type Mixed, SWINGS } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { readBack, restOf, traceAhead } from '@pg/blits/readBack';
import { useState, useSyncExternalStore } from 'react';
import s from './App.module.css';
import { docOf } from './docs';
import e from './Events.module.css';

const AHEAD = 1000;
const fixed = (n: number) => (Number.isFinite(n) ? n.toFixed(3).padStart(9) : '        –');
const shown = (pose: Mixed, ch: keyof Mixed) => {
  const v = pose[ch];
  return Array.isArray(v) ? v.map(fixed).join(' ') : fixed(v as number);
};

/**
 * The full mix read off the frame it plays: the picked subject at a past mix time by `project`,
 * its one-number channels over the time ahead by `trace`, and `atRest` and `inert` now.
 */
export function ReadBack({ player }: { player: Player }) {
  const { picked } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [ago, setAgo] = useState(500);
  const [ahead, setAhead] = useState(AHEAD);
  const subject = picked === null ? undefined : player.subjects[picked];
  if (subject === undefined) return null;
  const { mix } = player.built;
  const now = mix.now;
  const back = Math.min(ago, Math.max(0, now));
  const read = readBack(mix, subject, now - back);
  const traced = traceAhead(mix, subject, ahead);
  const rest = restOf(mix, subject);
  return (
    <section className={s.panel} aria-label="read back and ahead">
      <h3 className={s.heading}>read back and ahead</h3>
      <p className={s.row}>
        <span title={docOf('Mix.atRest')}>
          subject {picked} {rest.atRest ? 'at rest' : 'moving'}
        </span>
        ·
        <span title={docOf('Mix.inert')}>
          mix {rest.inert ? 'inert: another frame would change nothing' : 'not inert'}
        </span>
      </p>
      <label className={s.row} title={docOf('Mix.project')}>
        project
        <input
          type="range"
          min={0}
          max={Math.max(FRAME, now)}
          step={FRAME}
          value={back}
          aria-label="ms of mix time back"
          onChange={(ev) => setAgo(ev.target.valueAsNumber)}
        />
        <span className={s.clock}>{back.toFixed(0).padStart(5)} ms back</span>
      </label>
      {'error' in read ? (
        <p className={s.row}>{read.error}</p>
      ) : (
        <table className={e.table}>
          <thead>
            <tr>
              <th>channel</th>
              <th className={e.num}>at {read.at.toFixed(1)} ms</th>
              <th>doubt</th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((ch) => (
              <tr key={ch}>
                <td>{ch}</td>
                <td className={e.num}>{shown(read.pose, ch)}</td>
                <td>{read.doubts[ch]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label className={s.row} title={docOf('Mix.trace')}>
        trace ahead
        <input
          type="number"
          min={FRAME}
          step={100}
          value={ahead}
          aria-label="ms of mix time ahead to trace"
          onChange={(ev) => {
            const v = ev.target.valueAsNumber;
            if (Number.isFinite(v) && v > 0) setAhead(v);
          }}
        />
        ms
      </label>
      {'error' in traced ? (
        <p className={s.row}>{traced.error}</p>
      ) : (
        SWINGS.map((ch) => {
          const run = traced.runs[ch];
          const how = run.exact ? 'exact' : 'read on a grid';
          return (
            <ChannelPlot
              key={ch}
              label={`${ch} · ${how} · ${run.at.length} points`}
              times={run.at}
              series={[{ id: ch, hue: 0, color: 'var(--wzl-fg)', values: run.value, thick: true }]}
              playhead={traced.from}
              range={[traced.from, traced.to]}
            />
          );
        })
      )}
    </section>
  );
}
