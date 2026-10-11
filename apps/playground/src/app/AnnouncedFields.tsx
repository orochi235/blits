import { type Announced, type Composition, MAX_ANNOUNCED } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import s from './App.module.css';
import { docOf } from './docs';

function freshName(list: readonly Announced[]): string {
  const names = new Set(list.map((a) => a.name));
  if (!names.has('beat')) return 'beat';
  let n = 2;
  while (names.has(`beat ${n}`)) n++;
  return `beat ${n}`;
}

/** The marks the composition announces: each a name an anchor can target, at a time on its clock. */
export function AnnouncedFields({
  comp,
  onChange,
}: {
  comp: Composition;
  onChange(c: Composition): void;
}) {
  const list = comp.announced ?? [];
  const set = (next: Announced[]) =>
    onChange(withKey(comp, 'announced', next.length > 0 ? next : undefined));
  const tune = (i: number, change: Partial<Announced>) =>
    set(list.map((a, k) => (k === i ? { ...a, ...change } : a)));
  return (
    <fieldset className={s.field} title={docOf('Mix.announce')}>
      <legend>announced marks</legend>
      {list.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a mark being renamed has no other identity
        <div className={s.row} key={i}>
          <input
            className={s.text}
            aria-label={`mark ${i + 1} name`}
            value={a.name}
            onChange={(e) => tune(i, { name: e.target.value })}
          />
          at
          <input
            type="number"
            className={s.number}
            aria-label={`mark ${i + 1} at`}
            step={10}
            value={a.at}
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber)) tune(i, { at: e.target.valueAsNumber });
            }}
          />
          ms
          <button
            type="button"
            aria-label={`remove mark ${i + 1}`}
            onClick={() => set(list.filter((_, k) => k !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className={s.row}>
        <button
          type="button"
          disabled={list.length >= MAX_ANNOUNCED}
          onClick={() => set([...list, { name: freshName(list), at: 1000 }])}
        >
          add mark
        </button>
        <span className={s.note}>
          a voice anchored {'{"start": {"with": "beat"}}'} waits for it
        </span>
      </div>
    </fieldset>
  );
}
