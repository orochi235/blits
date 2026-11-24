import type { Tape } from '@msb235/blits';

/** Where a tape stands: how deep, the host time of its last call made, and those of the calls ahead. */
export interface Taped {
  depth: number;
  last: number | undefined;
  ahead: number[];
}

export const standOf = (tape: Tape | undefined): Taped | undefined => {
  if (tape === undefined) return undefined;
  const depth = tape.undoDepth();
  const ahead: number[] = [];
  for (let i = depth; ; i++) {
    const t = tape.timestampAt(i);
    if (t === undefined) break;
    ahead.push(t);
  }
  return { depth, last: tape.timestampAt(depth - 1), ahead };
};

/**
 * Who made the calls a tape took since `was`: the tape playing calls it held ahead, the host making
 * a new one, or nobody. A host call with calls ahead starts a new branch, stamped before them all,
 * so it never passes for one of them; letting go of old calls only makes the tape shallower.
 */
export function madeSince(was: Taped, now: Taped): 'tape' | 'host' | 'none' {
  const played = was.ahead.length - now.ahead.length;
  if (played > 0 && now.last === was.ahead[played - 1]) return 'tape';
  if (played !== 0 || now.depth > was.depth || (now.last !== undefined && now.last !== was.last))
    return 'host';
  return 'none';
}
