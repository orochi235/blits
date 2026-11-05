import { Button, PropertyField } from '@weasel-js/ui';
import { useState } from 'react';
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
      <PropertyField
        hug
        layout="inline"
        label="mix rate"
        description={docOf('Mix.rate')}
        kind="number"
        min={0}
        step={0.25}
        value={rate}
        onChange={(r) => {
          if (Number.isFinite(r) && r >= 0) onRate(r, over);
        }}
      />
      <PropertyField
        hug
        layout="inline"
        label="over"
        name="ramp or mute over, ms"
        description={docOf('Mix.ramp')}
        kind="number"
        min={0}
        step={100}
        unit="ms"
        placeholder="at once"
        value={over ?? null}
        onChange={(v) => setOver(Number.isFinite(v) && v > 0 ? v : undefined)}
        onClear={() => setOver(undefined)}
      />
      <Button tooltip={docOf('Mix.mute')} onClick={() => onMute(over)}>
        mute
      </Button>
    </>
  );
}
