import { hexOf } from '@pg/blits/color';
import type { ChannelName } from '@pg/blits/kit';
import { EasingPicker, type KeyEditorCtx, PropertyControl, PropertyRow } from '@weasel-js/ui';
import m from './PatchLive.module.css';

/** The selected key's value as inputs shaped to its channel, and the curve into it. */
export function KeyEditor({ key: k, track, commit, setEasing }: KeyEditorCtx) {
  const ch = track.label as ChannelName;
  const set = (value: unknown) => commit({ ...k, value });
  const num = (value: number, on: (n: number) => void, name: string) => (
    <PropertyControl
      key={name}
      kind="number"
      name={name}
      value={value}
      onChange={(n) => {
        if (Number.isFinite(n)) on(n);
      }}
    />
  );
  return (
    <div className={m.key}>
      <PropertyRow group label={`${ch} at ${Math.round(k.t)} ms`}>
        <div className={m.values}>
          {ch === 'color' ? (
            <PropertyControl
              kind="color"
              name="color"
              value={hexOf(k.value as number)}
              onChange={(hex) => set(Number.parseInt(hex.slice(1, 7), 16))}
            />
          ) : Array.isArray(k.value) ? (
            (k.value as number[]).map((x, i) =>
              num(
                x,
                (n) => set((k.value as number[]).map((y, j) => (j === i ? n : y))),
                `${ch} ${i}`,
              ),
            )
          ) : (
            num(k.value as number, set, ch)
          )}
        </div>
      </PropertyRow>
      <PropertyRow group label="curve in">
        <span className={m.curve}>
          <EasingPicker value={k.easing} onChange={setEasing} />
        </span>
      </PropertyRow>
    </div>
  );
}
