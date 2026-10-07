import type { Tape, TapeBranch, TapeMaker, TapeOp } from '../src/types.js';

interface Entry {
  id: number;
  label: string;
  at: number;
  ops: TapeOp[];
}

/**
 * A tape with weasel-history's semantics, branching on, over the methods a mix calls: the tests'
 * stand-in for `createHistory` from `@weasel-js/history`, whose published build lacks them yet.
 */
export const tape: TapeMaker = (adapter, opts) => {
  const undo: Entry[] = [];
  /** The future `redo` plays, next first. */
  let redo: Entry[] = [];
  /** Futures kept by a call made while `redo` held one, by the id of the entry they fork from. */
  const kept = new Map<number, Entry[][]>();
  let next = 1;
  const here = () => (undo.length === 0 ? 0 : (undo[undo.length - 1] as Entry).id);
  const view = (f: Entry[], current: boolean): TapeBranch => {
    const first = f[0] as Entry;
    return { id: first.id, label: first.label, timestamp: first.at, length: f.length, current };
  };
  const t: Tape = {
    recordEntry(ops, label) {
      if (redo.length > 0) {
        if (opts.branching) kept.set(here(), [...(kept.get(here()) ?? []), redo]);
        redo = [];
      }
      undo.push({ id: next++, label, at: opts.now(), ops });
    },
    undoDepth: () => undo.length,
    timestampAt: (i) => (i < undo.length ? undo[i]?.at : redo[i - undo.length]?.at),
    depthAt(at) {
      let n = undo.length;
      while (n > 0 && (undo[n - 1] as Entry).at > at) n--;
      if (n < undo.length) return n;
      for (const e of redo) {
        if (e.at > at) break;
        n++;
      }
      return n;
    },
    goto(n) {
      while (undo.length > n) {
        const e = undo.pop() as Entry;
        for (const op of [...e.ops].reverse()) op.invert().apply(adapter);
        redo.unshift(e);
      }
      while (undo.length < n && redo.length > 0) t.redo();
    },
    redo() {
      const e = redo.shift();
      if (e === undefined) return;
      for (const op of e.ops) op.apply(adapter);
      undo.push(e);
    },
    prune(at) {
      while (undo.length > 0 && (undo[0] as Entry).at < at) kept.delete((undo.shift() as Entry).id);
    },
    branches() {
      const out = (kept.get(here()) ?? []).map((f) => view(f, false));
      if (redo.length > 0) out.push(view(redo, true));
      return out.sort((a, b) => a.id - b.id);
    },
    switchBranch(id) {
      if (redo[0]?.id === id) return;
      const list = kept.get(here()) ?? [];
      const i = list.findIndex((f) => f[0]?.id === id);
      if (i < 0) throw new Error(`no branch ${id} forks here`);
      const [f] = list.splice(i, 1);
      if (redo.length > 0) list.push(redo);
      kept.set(here(), list);
      redo = f as Entry[];
    },
  };
  return t;
};
