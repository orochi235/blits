import type { FadeOptions, Handle } from '@msb235/blits';
import type { Subject } from '@pg/blits/stage';
import { useState } from 'react';
import s from './App.module.css';
import { docOf } from './docs';

type When = 'now' | 'rest' | 'at';

export interface FadeControlsProps {
  /** The subject picked on the stage, which a fade can take out of the voice alone. */
  subject: Subject | undefined;
  /** An owner fades as a whole: neither by subject nor at rest. */
  whole?: boolean;
  act(fn: (h: Handle<Subject>) => void): void;
}

const ms = (text: string) => {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** `handle.fade` with every option it takes, and `rise` to turn a fade back. */
export function FadeControls({ subject, whole = false, act }: FadeControlsProps) {
  const [over, setOver] = useState('');
  const [when, setWhen] = useState<When>('now');
  const [at, setAt] = useState('0');
  const [deadline, setDeadline] = useState('');
  const [one, setOne] = useState(false);

  const opts = (): FadeOptions<Subject> => {
    const o = ms(over);
    if (one && subject !== undefined) return { subject, ...(o !== undefined ? { over: o } : {}) };
    const d = ms(deadline);
    return {
      ...(o !== undefined ? { over: o } : {}),
      ...(when === 'rest' ? { at: 'rest' as const } : {}),
      ...(when === 'at' && ms(at) !== undefined ? { at: ms(at) } : {}),
      ...(when === 'rest' && d !== undefined ? { deadline: d } : {}),
    };
  };
  const field = (label: string, value: string, set: (v: string) => void, title?: string) => (
    <label className={s.row} title={title}>
      {label}
      <input
        type="number"
        min={0}
        step="any"
        placeholder="default"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <fieldset className={s.field} title={docOf('Handle.fade')}>
      <legend>fade</legend>
      <div className={s.row}>
        {field('over', over, setOver)}
        {!whole && (
          <label className={s.row}>
            <input
              type="checkbox"
              checked={one}
              disabled={subject === undefined}
              onChange={(e) => setOne(e.target.checked)}
            />
            only the picked subject
          </label>
        )}
      </div>
      {!one && (
        <div className={s.row}>
          <select aria-label="when" value={when} onChange={(e) => setWhen(e.target.value as When)}>
            <option value="now">now</option>
            {!whole && <option value="rest">at rest, per subject</option>}
            <option value="at">at mix time</option>
          </select>
          {when === 'at' && field('ms', at, setAt)}
          {when === 'rest' && field('deadline', deadline, setDeadline)}
        </div>
      )}
      <div className={s.row}>
        <button type="button" onClick={() => act((h) => h.fade(opts()))}>
          fade
        </button>
        <button
          type="button"
          title={docOf('Handle.rise')}
          onClick={() => {
            const o = ms(over);
            act((h) => h.rise(o !== undefined ? { over: o } : {}));
          }}
        >
          rise
        </button>
      </div>
    </fieldset>
  );
}
