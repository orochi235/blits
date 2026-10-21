import type { Composition } from '@pg/blits/composition';
import { withAhead } from '@pg/blits/edit';
import { AHEAD } from '@pg/blits/events';
import type { Player } from '@pg/blits/player';
import { ControlPanel, f, resolveConfigSchema } from '@weasel-js/labkit';
import { Button, PropertyRow } from '@weasel-js/ui';
import { type ReactNode, useState } from 'react';
import { AnnouncedFields } from './AnnouncedFields';
import s from './App.module.css';
import { fieldRow } from './CompositionControls';
import { docOf } from './docs';
import e from './Events.module.css';

const BOOKS = {
  tag: f
    .string('')
    .label('book and drain only the tag')
    .placeholder('every voice and group')
    .describe(docOf('Mix.drain') ?? '')
    .render(fieldRow({ layout: 'block', span: true })),
  ahead: f
    .number(AHEAD)
    .label('book ahead')
    .suffix('ms')
    .step(10)
    .describe(docOf('BookOptions.ahead') ?? '')
    .render(fieldRow({ layout: 'inline', name: 'book ahead in ms' })),
};
// Two schemas rather than a `showIf`: a section whose rows are all hidden still draws its heading.
const BOOKER = resolveConfigSchema(f.schema(BOOKS));
const BOOKER_LIVE = resolveConfigSchema(
  f.schema({
    ...BOOKS,
    name: f
      .string('beat')

      .label('announce')
      .describe(docOf('Mix.announce') ?? '')
      .section('live'),
    now: f.custom('now', null).section('live'),
  }),
);

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
  const write = (path: string, value: unknown) => {
    if (path === 'name') setName(String(value));
    if (path === 'tag') {
      events.tag = String(value).trim() || undefined;
      player.rebuild();
      onActed();
    }
    // blits' default is kept as no value, so a composition goes on following it.
    if (path === 'ahead') onComp(withAhead(comp, value === AHEAD ? undefined : (value as number)));
  };
  return (
    <div className={s.voiceColumn}>
      <AnnouncedFields comp={comp} onChange={onComp} />
      <section className={s.panel} aria-label="booker">
        <ControlPanel
          title="booker"
          pack="one-up"
          layout="inline"
          schema={live ? BOOKER_LIVE : BOOKER}
          config={{ tag: events.tag ?? '', ahead: comp.book?.ahead ?? AHEAD, name }}
          setConfig={write}
          renderers={{
            now: () => (
              <PropertyRow group layout="inline" label="">
                <Button
                  size="sm"
                  disabled={name.trim() === ''}
                  onClick={() => {
                    player.liveMix((m) => m.announce(name.trim()));
                    onActed();
                  }}
                >
                  announce now
                </Button>
              </PropertyRow>
            ),
          }}
        />
      </section>
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
        booked · mix.book, {built.ahead} ms ahead
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
