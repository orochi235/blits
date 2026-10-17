import type { Composition } from '@pg/blits/composition';
import { AHEAD } from '@pg/blits/events';
import type { Player } from '@pg/blits/player';
import { ExprInput } from '@pg/widgets/ExprInput';
import { type ReactNode, useState } from 'react';
import { AnnouncedFields } from './AnnouncedFields';
import s from './App.module.css';
import { docOf } from './docs';
import e from './Events.module.css';

/** The most rows a list draws, newest first. */
const SHOWN = 60;
const ms = (t: number) => t.toFixed(1);
const text = (event: unknown) => (typeof event === 'string' ? event : JSON.stringify(event));

function Table({ label, head, rows }: { label: string; head: string[]; rows: ReactNode }) {
  return (
    <div className={e.list}>
      <table className={e.table} aria-label={label}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export interface EventsPanelProps {
  player: Player;
  comp: Composition;
  onComp(c: Composition): void;
  live: boolean;
  /** Called after a change to the running mixes, so the panel redraws. */
  onActed(): void;
}

/** What the score knows and reports: `announce`, `marks`, `book`, and `drain`. */
export function EventsPanel({ player, comp, onComp, live, onActed }: EventsPanelProps) {
  const [name, setName] = useState('beat');
  const { built, events } = player;
  const names = new Map<number, string>();
  const groups = new Set<number>();
  for (const x of [...comp.voices, ...(comp.groups ?? [])]) {
    const h = player.handleOf(x.id);
    if (h) names.set(h.id, x.name);
    if (h && !('patch' in x)) groups.add(h.id);
  }
  const who = (voice: number | undefined, fallback?: string) =>
    (voice === undefined ? undefined : names.get(voice)) ?? fallback ?? '';
  const marks = built.mix.marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
  return (
    <div className={s.voiceColumn}>
      <AnnouncedFields comp={comp} onChange={onComp} />
      {live && (
        <div className={s.row} title={docOf('Mix.announce')}>
          <label className={s.row}>
            announce
            <input className={s.text} value={name} onChange={(x) => setName(x.target.value)} />
          </label>
          <button
            type="button"
            disabled={name.trim() === ''}
            onClick={() => {
              player.liveMix((m) => m.announce(name.trim()));
              onActed();
            }}
          >
            now
          </button>
        </div>
      )}
      <div title={docOf('Mix.drain')}>
        <ExprInput
          label="book and drain only the tag"
          placeholder="every voice and group"
          value={events.tag ?? ''}
          onCommit={(tag) => {
            events.tag = tag.trim() || undefined;
            player.rebuild();
            onActed();
          }}
        />
      </div>
      <h3 className={s.heading} title={docOf('Mix.marks')}>
        marks · mix.marks, on the host’s clock
      </h3>
      <Table
        label="marks"
        head={['ms', 'mark', 'of', 'tags']}
        rows={marks.slice(0, SHOWN * 2).map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two marks may share every field
          <tr key={i}>
            <td className={e.num}>{ms(m.timestamp)}</td>
            <td>{m.mark ?? 'announced'}</td>
            <td>{who(m.voice, m.name)}</td>
            <td>{m.tags.join(', ')}</td>
          </tr>
        ))}
      />
      <h3 className={s.heading} title={docOf('Mix.book')}>
        booked · mix.book, {AHEAD} ms ahead
      </h3>
      <Table
        label="booked"
        head={['when', 'late by', 'item', 'of']}
        rows={events.booked
          .slice(-SHOWN)
          .reverse()
          .map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a booking taken back and made again repeats
            <tr key={i} className={b.canceled ? e.canceled : undefined}>
              <td className={e.num}>{ms(b.when)}</td>
              <td className={e.num}>{ms(b.lateBy)}</td>
              <td>
                {'hit' in b.item
                  ? `hit ${text(b.item.event)}${groups.has(b.item.voice) ? '' : `, pass ${b.item.pass + 1}`}`
                  : (b.item.mark ?? 'announced')}
              </td>
              <td>{who(b.item.voice, b.item.name)}</td>
            </tr>
          ))}
      />
      <h3 className={s.heading} title={docOf('Mix.drain')}>
        sent · mix.drain, on the mix’s clock
      </h3>
      <Table
        label="sent"
        head={['ms', 'voice', 'subject', 'event']}
        rows={events.sent
          .slice(-SHOWN)
          .reverse()
          .map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one subject may send the same event twice in a frame
            <tr key={i}>
              <td className={e.num}>{ms(x.timestamp)}</td>
              <td>{who(x.voice)}</td>
              <td className={e.num}>{x.subject.index}</td>
              <td>{text(x.event)}</td>
            </tr>
          ))}
      />
    </div>
  );
}
