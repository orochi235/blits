import type { Handle, Mix, VoiceSpec } from './types.js';

/**
 * A subject's own `cue` and `drop`, from {@link bind}.
 *
 * @category mix
 */
export interface Binding<I, O, H = unknown> {
  /** Cues a voice on this subject alone; the spec names no `subjects`. */
  cue(spec: Omit<VoiceSpec<I, O, H>, 'subjects'>): Handle<I>;
  /** Cuts every voice cued here that is still playing, and drops the subject from the mix. */
  drop(): void;
}

/**
 * Binds a cue and a drop to one subject of `mix`, as a companion's emitter, sound, or body cues on
 * itself. A cue after `drop` throws.
 *
 * @category mix
 */
export function bind<I, O, H = unknown>(mix: Mix<I, O, H>, subject: I): Binding<I, O, H> {
  let dropped = false;
  const cued = new Set<Handle<I>>();
  return {
    cue(spec) {
      if (dropped) throw new Error('blits: that bound subject is dropped');
      if ('subjects' in spec)
        throw new Error('blits: a bound subject names its own subject; cue it without `subjects`');
      const h = mix.cue({ ...spec, subjects: [subject] } as VoiceSpec<I, O, H>);
      cued.add(h);
      void h.done.then(() => cued.delete(h));
      return h;
    },
    drop() {
      if (dropped) return;
      dropped = true;
      for (const h of cued) h.fade({ over: 0 });
      mix.drop(subject);
    },
  };
}
