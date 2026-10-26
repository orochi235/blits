import type { Laned } from './lane.js';
import type { Lanes } from './lanes.js';

/** Writes a subject's laned values into a pose. */
export type Copier = (pose: Record<string, unknown>, slot: number) => void;

/**
 * Writes a subject's laned values into a pose, each array channel into the array the pose holds
 * for it where that is the length a new one would be, as a host's `out` holds from its last probe.
 */
export function copy<I, O>(this: Lanes<I, O>, slot: number, pose: Record<string, unknown>): void {
  if (this.copier === null) this.copier = copier(this.laned);
  this.copier(pose, slot);
}

/** The array to hold an array channel's values for `slot`: `held` written over where it fits. */
export function filled(ch: Laned, slot: number, held: unknown): number[] {
  // Made as the general path makes it, a copy of rest, so poses from either path share a shape.
  const start = ch.start;
  const axes = ch.axes;
  const base = slot * axes;
  if (
    Array.isArray(held) &&
    held !== start &&
    held.length === (start.length > axes ? start.length : axes)
  ) {
    for (let a = 0; a < axes; a++) held[a] = ch.values[base + a] as number;
    for (let a = axes; a < start.length; a++) held[a] = start[a] as number;
    return held;
  }
  const arr = [...start];
  for (let a = 0; a < axes; a++) arr[a] = ch.values[base + a] as number;
  return arr;
}

/** Each set of laned channels' copier, made once from its source and bound to the channels. */
const made = new Map<string, ((chans: readonly Laned[], fill: typeof filled) => Copier) | null>();

/**
 * A copier for these channels, written out with each channel's name in place: a store under a name
 * that varies boxes every number it writes. Where `Function` is refused, a loop over them.
 */
export function copier(laned: readonly Laned[]): Copier {
  const lines: string[] = [];
  for (let c = 0; c < laned.length; c++) {
    const ch = laned[c] as Laned;
    const key = `o[${JSON.stringify(ch.name)}]`;
    const at = ch.scalar ? 's' : `s * ${ch.axes}`;
    // Never `delete`: it drops a reused out object into dictionary mode for good.
    const absent = `if (${key} !== undefined) ${key} = undefined;`;
    const write = ch.scalar
      ? `${key} = v;`
      : `{ const h = ${key}, a = f(c${c}, s, h); if (a !== h) ${key} = a; }`;
    lines.push(`{ const v = c${c}.values[${at}];`);
    lines.push(ch.op === 'last' ? `if (v !== v) { ${absent} } else ${write} }` : `${write} }`);
  }
  const body = lines.join('\n');
  let make = made.get(body);
  if (make === undefined) {
    const bind = laned.map((_, c) => `const c${c} = chans[${c}];`).join(' ');
    try {
      make = new Function(
        'chans',
        'f',
        `${bind}\nreturn function copyLaned(o, s) {\n${body}\n};`,
      ) as (chans: readonly Laned[], fill: typeof filled) => Copier;
    } catch {
      make = null;
    }
    made.set(body, make);
  }
  return make === null ? (pose, slot) => loop(laned, pose, slot) : make(laned, filled);
}

function loop(laned: readonly Laned[], pose: Record<string, unknown>, slot: number): void {
  for (let c = 0; c < laned.length; c++) {
    const ch = laned[c] as Laned;
    const v = ch.values[ch.scalar ? slot : slot * ch.axes] as number;
    if (ch.op === 'last' && Number.isNaN(v)) {
      if (pose[ch.name] !== undefined) pose[ch.name] = undefined;
    } else if (ch.scalar) pose[ch.name] = v;
    else {
      const held = pose[ch.name];
      const arr = filled(ch, slot, held);
      if (arr !== held) pose[ch.name] = arr;
    }
  }
}
