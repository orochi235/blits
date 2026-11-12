import type { OutlineChannel, OutlineVoice } from '@msb235/blits';
import { close, compile } from './compile';
import type { Composition } from './composition';
import { subjectsOf } from './stage';

/** What a composition's mix holds, by the voice or group id each outline voice was cued for. */
export interface Outlined {
  channels: readonly OutlineChannel[];
  voices: ReadonlyMap<string, OutlineVoice>;
  /** The voice or group id of each outline voice's `id`. */
  ids: ReadonlyMap<number, string>;
}

/**
 * `mix.describe()` of `comp` compiled afresh. Fresh, not the player's mix: that one lags an edit
 * by a render, and drops a voice from its outline once the voice is done.
 */
export function outlineOf(comp: Composition): Outlined {
  const built = compile(comp, subjectsOf(comp.stage));
  try {
    const o = built.mix.describe();
    const byHandle = new Map(o.voices.map((v) => [v.id, v]));
    const voices = new Map<string, OutlineVoice>();
    const ids = new Map<number, string>();
    for (const [id, h] of [...built.handles, ...built.groupHandles]) {
      const v = byHandle.get(h.id);
      if (v === undefined) continue;
      voices.set(id, v);
      ids.set(v.id, id);
    }
    return { channels: o.channels, voices, ids };
  } finally {
    close(built);
  }
}
