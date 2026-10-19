import type { Handle, Mix, VoiceSpec } from '@msb235/blits';
import { ParticleSystem } from 'three.quarks';
import type { AttachOptions } from './drive.js';

/** A particle system wired to a mix. Its emitters share it, so it compiles one shader. */
export interface Source<I, O> {
  readonly system: ParticleSystem;
  /** A new emission point on this system, and the mix's subject for it. */
  at(position: AttachOptions['at']): Emitter<I, O>;
  /**
   * A clone of the system (`system.clone()`), wired as a source of its own with no emitters. It
   * shares the material, and its `emitter` starts untransformed: add it to the scene and place it.
   */
  copy(): Source<I, O>;
  /** Drops every emitter on it. The system stays the host's to take out of its scene. */
  drop(): void;
}

/** One emission point on a source, and the mix's subject for it. */
export interface Emitter<I, O> {
  readonly source: Source<I, O>;
  /** Cues a voice on this emitter alone; the spec names no `subjects`. */
  cue(spec: Omit<VoiceSpec<I, O>, 'subjects'>): Handle<I>;
  /**
   * Emits `n` particles, floored, at the next write. It is not on the tape, so a seek does not replay
   * it; a burst that has to survive a seek is a patch `send`.
   */
  burst(n: number): void;
  /** Ends the voices cued on it, detaches it, and drops its subject from the mix. */
  drop(): void;
}

/** What `wire` needs of the driver it belongs to. */
export interface Host<I, O> {
  readonly mix: Mix<I, O>;
  attach(subject: I, system: ParticleSystem, at: AttachOptions['at']): void;
  detach(subject: I): void;
  burst(subject: I, n: number): void;
}

export function wire<I, O>(host: Host<I, O>, system: ParticleSystem): Source<I, O> {
  if (!(system instanceof ParticleSystem))
    throw new TypeError(
      'blits-quarks: wire takes a ParticleSystem, and that is not a ParticleSystem',
    );
  const live = new Set<Emitter<I, O>>();
  const source: Source<I, O> = {
    system,
    at(position) {
      let dropped = false;
      const cued = new Set<Handle<I>>();
      const emitter: Emitter<I, O> = {
        source,
        cue(spec) {
          if (dropped) throw new Error('blits-quarks: that emitter is dropped');
          if ('subjects' in spec)
            throw new Error(
              'blits-quarks: an emitter names its own subject; cue it without `subjects`',
            );
          const h = host.mix.cue({ ...spec, subjects: [emitter as unknown as I] } as VoiceSpec<
            I,
            O
          >);
          cued.add(h);
          void h.done.then(() => cued.delete(h));
          return h;
        },
        burst(n) {
          const whole = Math.floor(n);
          if (dropped || !Number.isFinite(whole) || whole <= 0) return;
          host.burst(emitter as unknown as I, whole);
        },
        drop() {
          if (dropped) return;
          dropped = true;
          for (const h of cued) h.fade({ over: 0 });
          live.delete(emitter);
          host.detach(emitter as unknown as I);
          host.mix.drop(emitter as unknown as I);
        },
      };
      host.attach(emitter as unknown as I, system, position);
      live.add(emitter);
      return emitter;
    },
    copy: () => wire(host, system.clone()),
    drop() {
      for (const e of [...live]) e.drop();
    },
  };
  return source;
}
