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
  transport.replaying = true;
  try {
    fn();
  } finally {
    transport.replaying = was;
  }
  record(this, label, (stage) => {
    // A read ahead holds copies of the mixes, and nothing of what `fn` changes.
    if (stage.mix(this) === this) fn();
  });
}
