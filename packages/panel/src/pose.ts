import { css, layersOf, partsOf, type Watched } from '@msb235/blits';

const DEPTH = 3;

/** Each numeric part of a pose under a flat key: `x`, `position[1]`, `color.l`. */
export function flatten(pose: unknown, out: Record<string, number> = {}, key = '', depth = 0) {
  if (typeof pose === 'number') {
    if (key !== '') out[key] = pose;
  } else if (Array.isArray(pose) || ArrayBuffer.isView(pose)) {
    if (depth < DEPTH)
      Array.from(pose as ArrayLike<unknown>).forEach((v, i) => {
        flatten(v, out, `${key}[${i}]`, depth + 1);
      });
  } else if (typeof pose === 'object' && pose !== null && depth < DEPTH)
    for (const [k, v] of Object.entries(pose))
      flatten(v, out, key === '' ? k : `${key}.${k}`, depth + 1);
  return out;
}

/** A color pose as the CSS color it shows, then an ordered blend mode's layers, bottom first. */
export const colorsOf = (pose: ArrayLike<number>): string[] => [
  css(pose),
  ...(layersOf(pose) ?? []),
];

const isColor = (kind: string | undefined) => kind !== undefined && /^(?:color|ink)\(/.test(kind);

/**
 * A pose as the plots show it, each channel read by its kind. A color channel, blend modes
 * included, is the CSS color it shows, then an ordered mode's layers bottom first; an `affine`
 * channel is its parts, `at.x` to `at.scaleY`; any other channel is its numbers by `flatten`.
 */
export function readPose(
  pose: unknown,
  entry: Pick<Watched, 'channels' | 'kinds'>,
): { values: Record<string, number>; colors: Record<string, string[]> } {
  const values: Record<string, number> = {};
  const colors: Record<string, string[]> = {};
  if (typeof pose !== 'object' || pose === null) return { values, colors };
  const fields = pose as Record<string, unknown>;
  const named = new Set(entry.channels);
  entry.channels.forEach((name, i) => {
    const v = fields[name];
    if (v === undefined) return;
    const kind = entry.kinds[i];
    if (isColor(kind) && isNumbers(v)) colors[name] = colorsOf(v);
    else if (kind === 'affine' && isNumbers(v))
      for (const [part, n] of Object.entries(partsOf(v))) values[`${name}.${part}`] = n;
    else flatten(v, values, name, 1);
  });
  for (const [k, v] of Object.entries(fields)) if (!named.has(k)) flatten(v, values, k, 1);
  return { values, colors };
}

const isNumbers = (v: unknown): v is ArrayLike<number> =>
  Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));
