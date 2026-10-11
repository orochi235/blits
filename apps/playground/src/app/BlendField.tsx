import { type Blend, stopOf } from '@pg/blits/blend';
import type { Expr } from '@pg/blits/composition';
import { ExprInput } from '@pg/widgets/ExprInput';
import s from './App.module.css';
import { docOf } from './docs';

const FRESH = '(s) => s.x';

export interface BlendFieldProps {
  locus: string;
  /** The blend this voice's locus is, if `mix.blend` cues it. */
  blend: Blend | undefined;
  /** The voice's id, to say which of the blend's stops it is. */
  id: string;
  error: string | null;
  /** Blends the locus by a signal, or with undefined goes back to each voice's own weight. */
  onChange(by: Expr | undefined): void;
}

/** A locus cued by `mix.blend`: the one signal its voices split, in place of a weight each. */
export function BlendField({ locus, blend, id, error, onChange }: BlendFieldProps) {
  if (!blend)
    return (
      <p className={s.row} title={docOf('Mix.blend')}>
        <button type="button" onClick={() => onChange({ code: FRESH })}>
          blend locus “{locus}”
        </button>
        <span className={s.note}>one signal in place of a weight each</span>
      </p>
    );
  const n = blend.members.length;
  const i = blend.members.findIndex((v) => v.id === id);
  return (
    <div className={s.field} title={docOf('Mix.blend')}>
      <ExprInput
        label="blend by"
        placeholder={FRESH}
        value={blend.by.code}
        error={error}
        onCommit={(code) => {
          if (code.trim() !== '') onChange({ code });
        }}
      />
      <p className={s.row}>
        <output>
          stop {i + 1} of {n}: full where the signal reads {stopOf(i, n).toFixed(2)}
        </output>
        <button type="button" onClick={() => onChange(undefined)}>
          unblend
        </button>
      </p>
      <p className={s.row}>
        <span className={s.note}>
          One spec plays every voice of a blend: a change here to timing, fade, stagger, target,
          freeze, anchor, or owner is made to all of them.
        </span>
      </p>
    </div>
  );
}
