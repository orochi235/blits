import { MARKS } from '@pg/blits/anchor';
import { type Group, MAX_HITS, MAX_MARKS, MAX_TAGS, type Voice } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { f } from '@weasel-js/labkit';
import { ListEditor, type PrefRenderContext, PropertyControl } from '@weasel-js/ui';
import { useEffect, useRef, useState } from 'react';
import { drafted } from './CompositionControls';
import g from './Group.module.css';

type Hit = NonNullable<Voice['hits']>[number];
type Mark = [name: string, at: number];

/** Tags as written: trimmed, each once, none empty, at most `MAX_TAGS`; none is undefined. */
function tagsIn(list: readonly string[]): string[] | undefined {
  const tags = [...new Set(list.map((t) => t.trim()))].filter(Boolean);
  return tags.length > 0 ? tags.slice(0, MAX_TAGS) : undefined;
}

/** Comma-separated words as tags; none is undefined. */
export const tagsOf = (text: string): string[] | undefined => tagsIn(text.split(','));

/** Why a mark cannot take `name`, or null when it can. */
function markFault(marks: readonly Mark[], i: number, name: string): string | null {
  const n = name.trim();
  if (!n) return 'needs a name';
  if (MARKS.includes(n)) return `“${n}” is one of a voice's own marks`;
  if (marks.some(([m], k) => k < i && m.trim() === n)) return `“${n}” is taken`;
  return null;
}

/**
 * A dialog's edits held until it closes, then written as one step: a list being typed passes
 * through states (an empty tag, a half-typed mark name) that the spec should never hold.
 */
function useDraft<T>(value: T, commit: (next: T) => void): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const latest = useRef({ draft, value, commit });
  latest.current = { draft, value, commit };
  useEffect(
    () => () => {
      const l = latest.current;
      if (JSON.stringify(l.draft) !== JSON.stringify(l.value)) l.commit(l.draft);
    },
    [],
  );
  return [draft, setDraft];
}

function TagsDialog({ row }: { row: PrefRenderContext }) {
  const [draft, setDraft] = useDraft((row.value as string[] | undefined) ?? [], (list) =>
    row.setValue(tagsIn(list)),
  );
  return (
    <ListEditor
      aria-label="tags"
      value={draft}
      onChange={setDraft}
      maxItems={MAX_TAGS}
      placeholder="lead"
      empty="no tags"
      addLabel="add tag"
    />
  );
}

function HitsDialog({ row, note }: { row: PrefRenderContext; note: string }) {
  const [draft, setDraft] = useDraft((row.value as Hit[] | undefined) ?? [], (hits) =>
    row.setValue(hits.length > 0 ? hits : undefined),
  );
  return (
    <div className={g.dialog}>
      <ListEditor<Hit>
        aria-label="hits"
        value={draft}
        onChange={setDraft}
        maxItems={MAX_HITS}
        empty="no hits"
        addLabel="add hit"
        newEntry={() => ({ at: 0, event: `hit ${draft.length + 1}` })}
        renderEntry={(h, set, name) => (
          <span className={`${g.entry} ${g.hit}`}>
            at
            <span>
              <PropertyControl
                kind="number"
                name={`${name} at`}
                min={0}
                step={10}
                value={h.at}
                onChange={(at) => set({ ...h, at: Math.max(0, at) })}
              />
            </span>
            ms sends
            <PropertyControl
              kind="string"
              name={`${name} event`}
              value={h.event}
              onChange={(event) => set({ ...h, event })}
            />
          </span>
        )}
      />
      <p className={g.note}>{note}</p>
    </div>
  );
}

function MarksDialog({ row, note }: { row: PrefRenderContext; note: string }) {
  const [draft, setDraft] = useDraft(
    Object.entries((row.value as Record<string, number> | undefined) ?? {}),
    (marks) => {
      const kept = marks
        .filter(([name], i) => markFault(marks, i, name) === null)
        .map(([name, at]): Mark => [name.trim(), at]);
      row.setValue(kept.length > 0 ? Object.fromEntries(kept) : undefined);
    },
  );
  const free = () => {
    for (let n = draft.length + 1; ; n++)
      if (!draft.some(([m]) => m === `mark${n}`)) return `mark${n}`;
  };
  return (
    <div className={g.dialog}>
      <ListEditor<Mark>
        aria-label="marks"
        value={draft}
        onChange={setDraft}
        maxItems={MAX_MARKS}
        empty="no marks"
        addLabel="add mark"
        newEntry={() => [free(), 0]}
        renderEntry={([markName, at], set, name, i) => {
          const fault = markFault(draft, i, markName);
          return (
            <span className={`${g.entry} ${g.mark}`}>
              <PropertyControl
                kind="string"
                name={`${name} name`}
                value={markName}
                onChange={(next) => set([next, at])}
              />
              at
              <span>
                <PropertyControl
                  kind="number"
                  name={`${name} at`}
                  min={0}
                  step={10}
                  value={at}
                  onChange={(ms) => set([markName, Math.max(0, ms)])}
                />
              </span>
              ms
              {fault && <span className={g.error}>{fault}: left out</span>}
            </span>
          );
        }}
      />
      <p className={g.note}>{note}</p>
    </div>
  );
}

const none = (n: number, text: string) => (n === 0 ? 'none' : text);

/**
 * A voice's or group's `tags`, `score`, `hits`, and `marks`: what marks, queries, bookers, and
 * drains know it by. The lists open in a dialog and are written when it closes. A group's hits are
 * booked once, since it does not loop.
 */
export function marksNodes(voice: boolean, doc: (member: string) => string | undefined) {
  const d = (member: string) => doc(member) ?? '';
  return {
    tags: f
      .list([])
      .describe(d('tags'))
      .dialog((row) => <TagsDialog row={row} />, {
        summary: (v) => none((v as string[]).length, (v as string[]).join(', ')),
      }),
    score: f
      .string('')
      .describe(d('score'))
      .render(drafted({ placeholder: "none: the mix's unnamed score" })),
    hits: f
      .list<Hit>([], f.object({ at: f.number(0), event: f.string('') }))
      .describe(d('hits'))
      .dialog(
        (row) => (
          <HitsDialog
            row={row}
            note={
              voice
                ? 'Booked once per pass, in voice ms; see the Events tab.'
                : 'Booked once, in ms on its clock; see the Events tab.'
            }
          />
        ),
        {
          summary: (v) => {
            const hits = v as Hit[];
            return none(hits.length, hits.map((h) => `${h.event} at ${h.at} ms`).join(', '));
          },
        },
      ),
    marks: f
      .map<number>({}, f.number(0))
      .describe(d('marks'))
      .dialog(
        (row) => (
          <MarksDialog
            row={row}
            note={
              voice
                ? 'Named for anchors, in voice ms; reached once, on the first pass.'
                : 'Named for anchors, in ms on its clock.'
            }
          />
        ),
        {
          summary: (v) => {
            const marks = Object.entries(v as Record<string, number>);
            return none(marks.length, marks.map(([n, at]) => `${n} at ${at} ms`).join(', '));
          },
        },
      ),
  };
}

/** The rows' values for `x`. */
export const marksConfig = (x: Voice | Group) => ({
  tags: x.tags ?? [],
  score: x.score ?? '',
  hits: x.hits ?? [],
  marks: x.marks ?? {},
});

/** The paths these rows write, and how each lands on the spec. */
export function writtenMarks<T extends Voice | Group>(
  x: T,
  path: string,
  value: unknown,
): T | undefined {
  switch (path) {
    case 'tags':
      return withKey(x, 'tags', value as string[] | undefined);
    case 'score':
      return withKey(x, 'score', (value as string).trim() || undefined);
    case 'hits':
      return withKey(x, 'hits', value as Hit[] | undefined);
    case 'marks':
      return withKey(x, 'marks', value as Record<string, number> | undefined);
    default:
      return undefined;
  }
}
