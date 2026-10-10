import type { Mixer } from './mixer.js';
import { scoredCut } from './scored.js';
import { Store } from './store.js';
import type { Voice } from './voice.js';

/**
 * A mix's gone voices as `drop` and a freed slot look for them: those over every subject, and the
 * rest by each subject they name. Kept in step with `gone`, which only grows by push and is
 * otherwise replaced whole, so it catches up lazily and rebuilds only on a replacement it did not
 * make itself. Under history a churning mix holds thousands, too many to walk per subject dropped.
 */
export class GoneIndex<I, O> {
  /** The `gone` list it was built over, and how much of it. */
  of: readonly Voice<I, O>[] | null = null;
  count = 0;
  general: Voice<I, O>[] = [];
  named = new Store<I, Voice<I, O>[]>();
  /** The latest `reachedTo` in `of`, and how far any voice's falls before one listed ahead of it. */
  latest = Number.NEGATIVE_INFINITY;
  slack = 0;
}

function add<I, O>(ix: GoneIndex<I, O>, voice: Voice<I, O>): void {
  const to = voice.reachedTo;
  if (to < ix.latest) ix.slack = Math.max(ix.slack, ix.latest - to);
  else ix.latest = to;
  if (voice.named === null) {
    ix.general.push(voice);
    return;
  }
  for (const subject of voice.named) {
    const list = ix.named.get(subject);
    if (list === undefined) ix.named.set(subject, [voice]);
    else list.push(voice);
  }
}

function remove<I, O>(ix: GoneIndex<I, O>, out: readonly Voice<I, O>[]): void {
  let general = false;
  for (const v of out) {
    if (v.named === null) {
      general = true;
      continue;
    }
    for (const subject of v.named) {
      const named = ix.named.get(subject);
      if (named === undefined) continue;
      const at = named.indexOf(v);
      if (at >= 0) named.splice(at, 1);
      if (named.length === 0) ix.named.delete(subject);
    }
  }
  if (general) {
    const leaving = new Set(out);
    ix.general = ix.general.filter((v) => !leaving.has(v));
  }
}

/** The index caught up with `mix.gone`. */
export function goneIndex<I, O>(mix: Mixer<I, O>): GoneIndex<I, O> {
  const ix = mix.goneIx;
  const list = mix.gone;
  if (ix.of !== list || ix.count > list.length) {
    ix.general = [];
    ix.named = new Store();
    ix.count = 0;
    ix.of = list;
    ix.latest = Number.NEGATIVE_INFINITY;
    ix.slack = 0;
  }
  for (let i = ix.count; i < list.length; i++) add(ix, list[i] as Voice<I, O>);
  ix.count = list.length;
  return ix;
}

/** Hands voices let go of from `gone` to the departed index, noting the latest that left. */
function forgot<I, O>(mix: Mixer<I, O>, out: readonly Voice<I, O>[]): void {
  for (const v of out) {
    mix.departed.add(mix, v);
    if (v.doneAt > mix.transport.forgotTo) mix.transport.forgotTo = v.doneAt;
  }
}

/**
 * Keeps the gone voices `keep` says yes to, asking it once each, and takes the rest out of the
 * index one by one. Leaves `gone` as it was when every one stays.
 */
export function keepGone<I, O>(mix: Mixer<I, O>, keep: (v: Voice<I, O>) => boolean): void {
  const ix = goneIndex(mix);
  const list = mix.gone;
  let i = 0;
  while (i < list.length && keep(list[i] as Voice<I, O>)) i++;
  if (i === list.length) return;
  const kept = list.slice(0, i);
  const out: Voice<I, O>[] = [list[i] as Voice<I, O>];
  for (i++; i < list.length; i++) {
    const v = list[i] as Voice<I, O>;
    (keep(v) ? kept : out).push(v);
  }
  remove(ix, out);
  forgot(mix, out);
  mix.gone = kept;
  scoredCut(mix, list, out);
  ix.of = kept;
  ix.count = kept.length;
}

/**
 * Lets go of the gone voices no seek or read back to `reach` finds playing: those that finished
 * before it, in a frame before it. Voices go in about that order, so only the front can hold one:
 * past the point where a voice is reached `slack` after `reach`, none behind it falls before.
 */
export function expireGone<I, O>(mix: Mixer<I, O>, reach: number): void {
  const ix = goneIndex(mix);
  if (!Number.isFinite(ix.slack)) {
    keepGone(mix, (v) => v.reachedTo >= reach);
    return;
  }
  const list = mix.gone;
  const edge = reach + ix.slack;
  let end = 0;
  let any = false;
  for (let seen = Number.NEGATIVE_INFINITY; end < list.length && seen < edge; end++) {
    const done = (list[end] as Voice<I, O>).reachedTo;
    if (done < reach) any = true;
    if (done > seen) seen = done;
  }
  if (!any) return;
  const kept: Voice<I, O>[] = [];
  const out: Voice<I, O>[] = [];
  for (let i = 0; i < end; i++) {
    const v = list[i] as Voice<I, O>;
    (v.reachedTo < reach ? out : kept).push(v);
  }
  list.splice(0, end, ...kept);
  remove(ix, out);
  forgot(mix, out);
  scoredCut(mix, list, out);
  ix.count = list.length;
}
