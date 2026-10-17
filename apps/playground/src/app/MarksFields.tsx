import { MARKS } from '@pg/blits/anchor';
import { type Group, MAX_HITS, MAX_MARKS, MAX_TAGS, type Voice } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { ExprInput } from '@pg/widgets/ExprInput';
import s from './App.module.css';
import { docOf } from './docs';

/** Comma-separated words as tags; none is undefined. */
export function tagsOf(text: string): string[] | undefined {
  const tags = [...new Set(text.split(',').map((t) => t.trim()))].filter(Boolean);
  return tags.length > 0 ? tags.slice(0, MAX_TAGS) : undefined;
}

type Hits = NonNullable<Voice['hits']>;

/**
 * A voice's or group's `tags`, `score`, `hits`, and `marks`: what marks, queries, bookers, and
 * drains know it by. A group's hits are booked once, since it does not loop.
 */
export function MarksFields<T extends Voice | Group>({
  x: v,
  onChange,
}: {
  x: T;
  onChange(x: T): void;
}) {
  const voice = 'patch' in v;
  const doc = (member: string) => docOf(`${voice ? 'VoiceSpec' : 'OwnerSpec'}.${member}`);
  const hits = v.hits ?? [];
  const setHits = (next: Hits) => onChange(withKey(v, 'hits', next.length > 0 ? next : undefined));
  const setHit = (i: number, change: Partial<Hits[number]>) =>
    setHits(hits.map((h, k) => (k === i ? { ...h, ...change } : h)));
  const marks = Object.entries(v.marks ?? {});
  const setMarks = (next: [string, number][]) =>
    onChange(withKey(v, 'marks', next.length > 0 ? Object.fromEntries(next) : undefined));
  const setMark = (i: number, name: string, at: number) =>
    setMarks(marks.map((m, k) => (k === i ? [name, at] : m)));
  const free = () => {
    for (let n = marks.length + 1; ; n++)
      if (!marks.some(([m]) => m === `mark${n}`)) return `mark${n}`;
  };
  return (
    <fieldset className={s.field}>
      <legend>tags, score, hits, and marks</legend>
      <div title={doc('tags')}>
        <ExprInput
          label="tags"
          placeholder="lead, sound"
          value={(v.tags ?? []).join(', ')}
          onCommit={(text) => onChange(withKey(v, 'tags', tagsOf(text)))}
        />
      </div>
      <div title={doc('score')}>
        <ExprInput
          label="score"
          placeholder="none: the mix's unnamed score"
          value={v.score ?? ''}
          onCommit={(text) => onChange(withKey(v, 'score', text.trim() || undefined))}
        />
      </div>
      <div className={s.field} title={doc('hits')}>
        {hits.map((h, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: hits have no identity but their place
          <div className={s.row} key={i}>
            hit at
            <input
              type="number"
              className={s.number}
              aria-label={`hit ${i + 1} at`}
              min={0}
              step={10}
              value={h.at}
              onChange={(e) => {
                const at = e.target.valueAsNumber;
                if (Number.isFinite(at) && at >= 0) setHit(i, { at });
              }}
            />
            ms sends
            <input
              className={s.text}
              aria-label={`hit ${i + 1} event`}
              value={h.event}
              onChange={(e) => setHit(i, { event: e.target.value })}
            />
            <button
              type="button"
              aria-label={`remove hit ${i + 1}`}
              onClick={() => setHits(hits.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <div className={s.row}>
          <button
            type="button"
            disabled={hits.length >= MAX_HITS}
            onClick={() => setHits([...hits, { at: 0, event: `hit ${hits.length + 1}` }])}
          >
            add hit
          </button>
          <span className={s.note}>
            {voice
              ? 'booked once per pass, in voice ms; see the Events tab'
              : 'booked once, in ms on its clock; see the Events tab'}
          </span>
        </div>
      </div>
      <div className={s.field} title={doc('marks')}>
        {marks.map(([name, at], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a mark being renamed keeps its place
          <div className={s.row} key={i}>
            mark
            <input
              key={name}
              className={s.text}
              aria-label={`mark ${i + 1} name`}
              defaultValue={name}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const n = e.target.value.trim();
                if (n && !MARKS.includes(n) && !marks.some(([m], k) => k !== i && m === n))
                  setMark(i, n, at);
                else e.target.value = name;
              }}
            />
            at
            <input
              type="number"
              className={s.number}
              aria-label={`mark ${i + 1} at`}
              min={0}
              step={10}
              value={at}
              onChange={(e) => {
                const ms = e.target.valueAsNumber;
                if (Number.isFinite(ms) && ms >= 0) setMark(i, name, ms);
              }}
            />
            ms
            <button
              type="button"
              aria-label={`remove mark ${i + 1}`}
              onClick={() => setMarks(marks.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <div className={s.row}>
          <button
            type="button"
            disabled={marks.length >= MAX_MARKS}
            onClick={() => setMarks([...marks, [free(), 0]])}
          >
            add mark
          </button>
          <span className={s.note}>
            {voice
              ? 'named for anchors, in voice ms; reached once, on the first pass'
              : 'named for anchors, in ms on its clock'}
          </span>
        </div>
      </div>
    </fieldset>
  );
}
