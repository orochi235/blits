import type { Mixer } from './mixer.js';
import { record } from './tape.js';
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

/** Tells the transport's listeners where a seek landed, then each mix's on it. */
export function told(transport: Transport, s: Sought): void {
  for (const fn of [...transport.seekFns]) fn(s);
  for (const m of [...transport.members]) {
    const fns = m.seekFns;
    if (fns !== null) for (const fn of [...fns]) fn(s);
  }
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
