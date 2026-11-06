import { useMemo } from 'react';
import css from './FoldStamp.module.css';
import { type StampOptions, stampUrl } from './stamp';

export type { StampEncoding, StampLine, StampRamp } from './stamp';
export type FoldStampProps = StampOptions;

export function FoldStamp(props: FoldStampProps) {
  const { rule, size = 128, weight = 1, line, encode, ramp } = props;
  const src = useMemo(
    () =>
      stampUrl({
        rule,
        size,
        weight,
        ...(line ? { line } : {}),
        ...(encode ? { encode } : {}),
        ...(ramp ? { ramp } : {}),
      }),
    [rule, size, weight, line, encode, ramp],
  );
  return (
    <img
      className={css.stamp}
      src={src}
      width={size}
      height={size}
      alt={`${rule} at weight ${weight}`}
    />
  );
}
