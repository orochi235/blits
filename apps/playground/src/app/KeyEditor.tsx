import { hexOf } from '@pg/blits/color';
import type { ChannelName } from '@pg/blits/kit';
import { EasingPicker, type KeyEditorCtx } from '@weasel-js/ui';
import s from './App.module.css';

/** The selected key's value as inputs shaped to its channel, and the curve into it. */
export function KeyEditor({ key: k, track, commit, setEasing }: KeyEditorCtx) {
  const ch = track.label as ChannelName;
  const set = (value: unknown) => commit({ ...k, value });
  const num = (value: number, on: (n: number) => void, label: string) => (
    <input
      key={label}
      type="number"
      step="any"
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (Number.isFinite(e.target.valueAsNumber)) on(e.target.valueAsNumber);
      }}
    />
  );
  return (
    <div className={s.field}>
      <div className={s.row}>
        {ch} at {Math.round(k.t)} ms
        {ch === 'color' ? (
          <input
            type="color"
            aria-label="color"
            value={hexOf(k.value as number)}
            onChange={(e) => set(Number.parseInt(e.target.value.slice(1), 16))}
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
      <EasingPicker value={k.easing} onChange={setEasing} />
    </div>
  );
}
