import { useState } from 'react';
import s from './App.module.css';
import { docOf } from './docs';

/**
 * The full mix's own rate and `mute`, in live mode. One `over` serves both: a rate ramps over it,
 * and a mute fades over it; blank, a rate is set at once and a mute takes each voice's `fade.out`.
 */
export function LiveMix({
  rate,
  onRate,
  onMute,
}: {
  rate: number;
  onRate(r: number, over: number | undefined): void;
  onMute(over: number | undefined): void;
}) {
  const [over, setOver] = useState<number | undefined>(undefined);
  return (
    <>
      <label className={s.level} title={docOf('Mix.rate')}>
        mix rate
        <input
          type="number"
          min={0}
          step={0.25}
          value={rate}
          onChange={(e) => {
            const r = e.target.valueAsNumber;
            if (Number.isFinite(r) && r >= 0) onRate(r, over);
          }}
        />
      </label>
      <label className={s.level} title={docOf('Mix.ramp')}>
        over
        <input
          type="number"
          min={0}
          step={100}
          placeholder="at once"
          aria-label="ramp or mute over, ms"
          value={over ?? ''}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            setOver(Number.isFinite(v) && v > 0 ? v : undefined);
          }}
        />
        ms
      </label>
      <button type="button" title={docOf('Mix.mute')} onClick={() => onMute(over)}>
        mute
      </button>
    </>
  );
}
