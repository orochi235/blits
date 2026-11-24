import type { Mixer } from './mixer.js';
import { record } from './tape.js';
import { throwLater } from './ticker.js';
import type { Transport } from './transport.js';
import type { Sought } from './types/mix.js';

/** Adds `fn` to `fns`, answering the function that takes it off again. */
export function listen<F>(fns: F[], fn: F): () => void {
  fns.push(fn);
  return () => {
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
  };
}

/** As `Mix.onSeek`. */
export function onSeek<I, O>(this: Mixer<I, O>, fn: (s: Sought) => void): () => void {
  this.seekFns ??= [];
  return listen(this.seekFns, fn);
}

/**
 * Tells the transport's listeners where a seek landed, then each mix's on it, until one moves the
 * transport on to another frame, by a seek or a sync, whose own news is the latest.
 */
export function told(transport: Transport, s: Sought): void {
  const seq = transport.seq;
  if (!tell(transport.seekFns, s, transport, seq)) return;
  for (const m of [...transport.members]) {
    const fns = m.seekFns;
    if (fns !== null && !tell(fns, s, transport, seq)) return;
  }
}

/** Calls each of `fns` with `s` while the transport stays on frame `seq`, and answers whether it did. */
function tell(fns: ((s: Sought) => void)[], s: Sought, transport: Transport, seq: number): boolean {
  for (const fn of [...fns]) {
    try {
      fn(s);
    } catch (err) {
      throwLater(err);
    }
    if (transport.seq !== seq) return false;
  }
  return true;
}

/** As `Mix.call`. */
export function call<I, O>(this: Mixer<I, O>, label: string, fn: () => void): void {
  this.attached();
  const transport = this.transport;
  // What `fn` calls on the mix is the call's own, made again with it, so it is not recorded apart.
  const was = transport.replaying;
  const from = transport.nextId;
  transport.replaying = true;
  try {
    fn();
  } finally {
    transport.replaying = was;
  }
  const to = transport.nextId;
  record(this, label, (stage) => {
    // A read ahead holds copies of the mixes, and nothing of what `fn` changes.
    if (stage.mix(this) !== this) return;
    // What `fn` cues takes the numbers it took the first time, so it sorts among later cues, which
    // the tape makes again with theirs, as it did then.
    const top = transport.nextId;
    transport.nextId = to > from ? from : top;
    transport.idsTo = to;
    transport.idsTop = top;
    try {
      fn();
    } finally {
      transport.nextId = Math.max(top, transport.nextId);
      transport.idsTo = Number.NaN;
      transport.idsTop = Number.NaN;
    }
  });
}
