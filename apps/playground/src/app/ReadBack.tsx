import { ChannelPlot } from '@msb235/blits-panel';
import { FRAME } from '@pg/blits/frame';
import { CHANNELS, type Mixed, SWINGS } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { readBack, restOf, traceAhead } from '@pg/blits/readBack';
import { DataGrid, type DataGridColumn, PropertyField } from '@weasel-js/ui';
import { useState, useSyncExternalStore } from 'react';
import s from './App.module.css';
import { docOf } from './docs';

const AHEAD = 1000;
const fixed = (n: number) => (Number.isFinite(n) ? n.toFixed(3).padStart(9) : '        –');
const shown = (pose: Mixed, ch: keyof Mixed) => {
  const v = pose[ch];
  return Array.isArray(v) ? v.map(fixed).join(' ') : fixed(v as number);
};

type Read = { id: string; value: string; doubt: string };
const readColumns = (at: number): DataGridColumn<Read>[] => [
  { id: 'id', header: 'channel', sortable: false },
  { id: 'value', header: `at ${at.toFixed(1)} ms`, numeric: true, sortable: false },
  { id: 'doubt', header: 'doubt', sortable: false },
];

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
      <PropertyField
        layout="inline"
        label="project back"
        name="ms of mix time back"
        description={docOf('Mix.project')}
        kind="number"
        control="slider"
        min={0}
        max={Math.max(FRAME, now)}
        step={FRAME}
        unit="ms"
        value={back}
        onInput={setAgo}
        onChange={setAgo}
      />
      {'error' in read ? (
        <p className={s.row}>{read.error}</p>
      ) : (
        <DataGrid
          columns={readColumns(read.at)}
          rows={CHANNELS.map((ch) => ({
            id: ch,
            value: shown(read.pose, ch),
            doubt: read.doubts[ch],
          }))}
        />
      )}
      <PropertyField
        layout="inline"
        label="trace ahead"
        name="ms of mix time ahead to trace"
        description={docOf('Mix.trace')}
        kind="number"
        min={FRAME}
        step={100}
        unit="ms"
        value={ahead}
        onChange={(v) => {
          if (Number.isFinite(v) && v > 0) setAhead(v);
        }}
      />
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
