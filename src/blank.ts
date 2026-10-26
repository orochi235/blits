import type { Channel } from './types.js';

/**
 * A maker of empty poses for one kit: plain objects holding each channel with a rest, in kit order,
 * a number rest at its value and any other as `undefined` until the fold writes it.
 *
 * `{}` shares V8's chain of shapes with every small object literal, so a host's
 * `kit({ gain: mul() })` leaves `gain` a field that boxes each number stored in it. A constructor of
 * the mix's own starts a chain of its own, where a number field stays a double.
 */
export function blanks<O>(
  names: readonly string[],
  channels: readonly Channel<unknown>[],
): () => O {
  const keys: string[] = [];
  const starts: unknown[] = [];
  for (let i = 0; i < names.length; i++) {
    const rest = (channels[i] as Channel<unknown>).rest;
    if (rest === undefined) continue;
    keys.push(names[i] as string);
    starts.push(typeof rest === 'number' ? rest : undefined);
  }
  function Pose(this: Record<string, unknown>): void {
    for (let i = 0; i < keys.length; i++) this[keys[i] as string] = starts[i];
  }
  Pose.prototype = Object.prototype;
  const P = Pose as unknown as new () => O;
  return () => new P();
}
