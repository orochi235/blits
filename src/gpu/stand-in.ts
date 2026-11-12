import type { Voice } from '../voice.js';
import type { Built } from './compile.js';
import type { Runner } from './runner.js';

/** A compiled kernel, with what it was built for. */
export interface Ready {
  readonly built: Built;
  /** How many of the side's runners it runs: those at lower places. */
  readonly count: number;
  readonly channels: ReadonlySet<string>;
  readonly n: number;
}

/** A frame folded on `Ready`'s kernel while the one for its voices compiles. */
export interface StandIn<I> {
  readonly built: Built;
  readonly voices: Voice<I, unknown>[];
  readonly runners: Runner[];
  /** The voices folded through the host runner, whose values the CPU works out. */
  readonly hosted: ReadonlySet<Voice<I, unknown>>;
  /** The channels this fold gives; the rest of the frame's stay on the CPU. */
  readonly channels: ReadonlySet<string>;
}

/**
 * How a compiled kernel folds this frame's voices: each voice whose runner it has runs on it,
 * each `hostable` one runs through `host`, and every channel any other voice writes, or that the
 * kernel does not fold, stays on the CPU. Null where it folds no channel or has another subject
 * count. Exact for every channel it gives: each folds every voice writing it, in voice order.
 */
export function standIn<I>(
  ready: Ready | null,
  voices: readonly Voice<I, unknown>[],
  runners: readonly Runner[],
  index: ReadonlyMap<string, number>,
  channels: Iterable<string>,
  n: number,
  host: Runner,
  hostable: (voice: Voice<I, unknown>) => boolean,
): StandIn<I> | null {
  if (ready === null || ready.n !== n || ready.built.pipeline === null || ready.built.failed)
    return null;
  const kept = new Set<string>();
  const hosted = new Set<Voice<I, unknown>>();
  voices.forEach((v, k) => {
    if ((index.get((runners[k] as Runner).key) as number) < ready.count) return;
    if (hostable(v)) hosted.add(v);
    else for (const name of v.patch.writes as readonly string[]) kept.add(name);
  });
  const folds = new Set<string>();
  for (const name of channels) if (ready.channels.has(name) && !kept.has(name)) folds.add(name);
  if (folds.size === 0) return null;
  const out: Voice<I, unknown>[] = [];
  const run: Runner[] = [];
  voices.forEach((v, k) => {
    if (!(v.patch.writes as readonly string[]).some((name) => folds.has(name))) return;
    out.push(v);
    run.push(hosted.has(v) ? host : (runners[k] as Runner));
  });
  return { built: ready.built, voices: out, runners: run, hosted, channels: folds };
}
