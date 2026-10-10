import type { Composition, MixSettings } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import { withKey } from '@pg/blits/keyed';
import s from './App.module.css';
import { docOf } from './docs';

/** The `MixOptions` a composition sets for every mix it plays in. */
export function MixPanel({
  comp,
  onChange,
}: {
  comp: Composition;
  onChange(c: Composition): void;
}) {
  const m = comp.mix ?? {};
  const set = <K extends keyof MixSettings>(key: K, value: MixSettings[K] | undefined) => {
    const next = withKey(m, key, value);
    onChange(withKey(comp, 'mix', Object.keys(next).length > 0 ? next : undefined));
  };
  const stepOff = m.stepMs === 'off';
  return (
    <fieldset className={s.panel} aria-label="mix">
      <legend>mix</legend>
      <div className={s.row} title={docOf('MixOptions.stepMs')}>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={!stepOff}
            onChange={(e) => set('stepMs', e.target.checked ? undefined : 'off')}
          />
          step every
        </label>
        <input
          type="number"
          min={1}
          step="any"
          aria-label="stepMs"
          disabled={stepOff}
          value={stepOff ? '' : (m.stepMs ?? Math.round(FRAME * 100) / 100)}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n) && n > 0) set('stepMs', n);
          }}
        />
        ms
      </div>
      <label className={s.row} title={docOf('MixOptions.maxDt')}>
        maxDt
        <input
          type="number"
          min={1}
          step="any"
          placeholder="off"
          value={m.maxDt ?? ''}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            set('maxDt', Number.isFinite(n) && n > 0 ? n : undefined);
          }}
        />
      </label>
      <label className={s.row} title={docOf('MixOptions.reduce')}>
        <input
          type="checkbox"
          checked={m.reduce === true}
          onChange={(e) => set('reduce', e.target.checked || undefined)}
        />
        reduced motion
      </label>
      <label className={s.row} title={docOf('MixOptions.lanes')}>
        <input
          type="checkbox"
          checked={m.lanes !== false}
          onChange={(e) => set('lanes', e.target.checked ? undefined : false)}
        />
        lanes
      </label>
    </fieldset>
  );
}
