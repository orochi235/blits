import type { Composition } from '@pg/blits/composition';
import { withAhead } from '@pg/blits/edit';
import { AHEAD } from '@pg/blits/events';
import type { Player } from '@pg/blits/player';
import { ControlPanel, f, resolveConfigSchema } from '@weasel-js/labkit';
import { Button, DataGrid, type DataGridColumn, PropertyRow } from '@weasel-js/ui';
import { useState } from 'react';
import { AnnouncedFields } from './AnnouncedFields';
import s from './App.module.css';
import { fieldRow } from './CompositionControls';
import { docOf } from './docs';
import e from './Events.module.css';
import { ms } from './ms';

const BOOKER = resolveConfigSchema(
  f.schema({
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
    name: f
      .string('beat')
      .label('announce')
      .describe(docOf('Mix.announce') ?? '')
      .section('live')
      .showIf((c) => c.live === true),
    now: f
      .custom('now', null)
      .section('live')
      .showIf((c) => c.live === true),
  }),
);

/** The most rows a list draws, newest first. */
const SHOWN = 60;
const text = (event: unknown) => (typeof event === 'string' ? event : JSON.stringify(event));

type Cells = { id: string; canceled?: boolean } & Record<
  string,
  string | number | boolean | undefined
>;

const column = (id: string, header: string, numeric = false): DataGridColumn<Cells> => ({
  id,
  header,
  numeric,
  sortable: false,
  render: (row) => String(row[id] ?? ''),
});

function Table({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: DataGridColumn<Cells>[];
  rows: Cells[];
}) {
  return (
    <section className={e.list} aria-label={label}>
      <DataGrid
        className={e.table}
        columns={columns}
        rows={rows}
        rowClassName={(row) => (row.canceled ? e.canceled : undefined)}
      />
    </section>
  );
}

const MARKS = [
  column('ms', 'ms', true),
  column('mark', 'mark'),
  column('of', 'of'),
  column('tags', 'tags'),
];
const BOOKED = [
  column('when', 'when', true),
  column('late', 'late by', true),
  column('item', 'item'),
  column('of', 'of'),
];
const SENT = [
  column('ms', 'ms', true),
  column('voice', 'voice'),
  column('subject', 'subject', true),
  column('event', 'event'),
];

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
          schema={BOOKER}
          config={{ tag: events.tag ?? '', ahead: comp.book?.ahead ?? AHEAD, name, live }}
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
        columns={MARKS}
        rows={marks.slice(0, SHOWN * 2).map((m, i) => ({
          id: String(i),
          ms: ms(m.timestamp),
          mark: m.mark ?? 'announced',
          of: who(m.voice, m.name),
          tags: m.tags.join(', '),
        }))}
      />
      <h3 className={s.heading} title={docOf('Mix.book')}>
        booked · mix.book, {built.ahead} ms ahead
      </h3>
      <Table
        label="booked"
        columns={BOOKED}
        rows={events.booked
          .slice(-SHOWN)
          .reverse()
          .map((b, i) => ({
            id: String(i),
            canceled: b.canceled,
            when: ms(b.when),
            late: ms(b.lateBy),
            item:
              'hit' in b.item
                ? `hit ${text(b.item.event)}${groups.has(b.item.voice) ? '' : `, pass ${b.item.pass + 1}`}`
                : (b.item.mark ?? 'announced'),
            of: who(b.item.voice, b.item.name),
          }))}
      />
      <h3 className={s.heading} title={docOf('Mix.drain')}>
        sent · mix.drain, on the mix’s clock
      </h3>
      <Table
        label="sent"
        columns={SENT}
        rows={events.sent
          .slice(-SHOWN)
          .reverse()
          .map((x, i) => ({
            id: String(i),
            ms: ms(x.timestamp),
            voice: who(x.voice),
            subject: x.subject.index,
            event: text(x.event),
          }))}
      />
    </div>
  );
}
