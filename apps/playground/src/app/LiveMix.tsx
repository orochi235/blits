import { Button, PropertyField } from '@weasel-js/ui';
import { docOf } from './docs';

/**
 * Live mode's `over` and `mute`. One `over` serves both: the transport's rate ramps over it, and a
 * mute fades over it; blank, a rate is set at once and a mute takes each voice's `fade.out`.
 */
export function LiveMix({
  over,
  onOver,
  onMute,
}: {
  over: number | undefined;
  onOver(over: number | undefined): void;
  onMute(): void;
}) {
  return (
    <>
      <PropertyField
        hug
        layout="inline"
        label="over"
        name="ramp or mute over, ms"
        description={docOf('Transport.ramp')}
        kind="number"
        min={0}
        step={100}
        unit="ms"
        placeholder="at once"
        value={over ?? null}
        onChange={(v) => onOver(Number.isFinite(v) && v > 0 ? v : undefined)}
        onClear={() => onOver(undefined)}
      />
      <Button tooltip={docOf('Mix.mute')} onClick={onMute}>
        mute
      </Button>
    </>
  );
}
