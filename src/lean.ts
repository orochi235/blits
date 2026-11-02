import { made } from './mixer.js';
import type { Engine, Kit, Mix, MixOptions } from './types.js';

export * from './index.js';

/**
 * The stock engine without lanes: every voice folds subject by subject, to the same values, and a
 * bundle that takes `mix` from here leaves the lanes' code out. `lanes: true` is refused.
 *
 * @category engine
 */
export const lean: Engine = {
  name: 'lean',
  runs: new Set<'fn' | 'keys' | 'motion'>(['fn', 'keys', 'motion']),
  create<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H>): Mix<I, O, H> {
    return made<I, O, H>(kit, opts, null);
  },
};

/**
 * Makes a mix, the object that plays animations. The kit says which values each subject has and
 * how they combine; cue voices on the mix, then each frame `sync` it to the time and `probe` each
 * subject for its pose. Imported from here, it runs on `lean` unless the options name an engine.
 *
 * @category mix
 */
export function mix<I, O, H = unknown>(kit: Kit<O>, opts: MixOptions<H> = {}): Mix<I, O, H> {
  return (opts.engine ?? lean).create<I, O, H>(kit, opts);
}
