import { retime } from './clock.js';
import type { FadeOptions, Fitted, Handle } from './types.js';
import type { Voice } from './voice.js';

/** What a voice's handle asks of the mix that cued it: one per mix, shared by every handle. */
export interface HandleHost<I, O> {
  /** The mix clock, or the voice's start before the first sync. */
  nowFor(voice: Voice<I, O>): number;
  /** A handle write changed the voice: reschedule it, and refill the lanes. */
  changed(voice: Voice<I, O>): void;
  /** The voice's clock jumped: for an owner, so did every clock it holds. */
  sought(voice: Voice<I, O>): void;
  fade(voice: Voice<I, O>, opts: FadeOptions<I> | undefined): void;
  rise(voice: Voice<I, O>, opts: { over?: number } | undefined): void;
  weightOf(voice: Voice<I, O>, subject: I): number;
  /** Records a write the host made, which `again` makes once more where a seek replays it. */
  record(label: string, again: () => void): void;
}

/** What a handle answers for a voice a history store paged out, which left long ago. */
export interface Gone {
  weight: number;
  played: boolean;
}

/**
 * A voice's handle: the host's only way to control a voice once cued. A voice a history store
 * pages out is let go of here too, so the handle answers as a gone voice's does, and a seek that
 * revives it puts the revived voice behind the same handle.
 */
export class VoiceHandle<I, O> implements Handle<I> {
  readonly id: number;
  #voice: Voice<I, O> | null;
  #gone: Gone | null = null;
  readonly #host: HandleHost<I, O>;

  constructor(voice: Voice<I, O>, host: HandleHost<I, O>) {
    this.id = voice.id;
    this.#voice = voice;
    this.#host = host;
  }

  /** The voice behind a handle; null while a history store holds it. */
  static voiceOf<I, O>(h: VoiceHandle<I, O>): Voice<I, O> | null {
    return h.#voice;
  }

  /** Lets go of a voice a history store paged out. */
  static page<I, O>(h: VoiceHandle<I, O>, gone: Gone): void {
    h.#voice = null;
    h.#gone = gone;
  }

  /** Puts a voice revived from a history store behind the handle it had. */
  static rehome<I, O>(h: VoiceHandle<I, O>, voice: Voice<I, O>): void {
    h.#voice = voice;
    h.#gone = null;
  }

  get state(): Handle<I>['state'] {
    return this.#voice?.state ?? 'done';
  }

  get owner(): Handle<I> | undefined {
    return this.#voice?.owner?.handle ?? undefined;
  }

  get played(): Promise<boolean> {
    return this.#voice?.played ?? Promise.resolve(this.#gone?.played ?? false);
  }

  get done(): Promise<void> {
    return this.#voice?.done ?? Promise.resolve();
  }

  /** How a span's children were last fitted; undefined for any voice but a span. */
  get fitted(): Fitted | undefined {
    return this.#voice?.fitting?.report;
  }

  get weight(): number {
    return this.#voice?.weight ?? this.#gone?.weight ?? 0;
  }

  // A write to a paged voice changes nothing: it had left when the host made it, as it has on replay.
  set weight(w: number) {
    const voice = this.#voice;
    if (voice === null) return;
    voice.weight = w;
    this.#host.changed(voice);
    this.#host.record('weight', () => {
      this.weight = w;
    });
  }

  get rate(): number {
    const voice = this.#voice;
    return voice === null ? 0 : voice.rateAt(this.#host.nowFor(voice));
  }

  set rate(r: number) {
    this.ramp(r, 0);
  }

  ramp(r: number, over: number): void {
    const voice = this.#voice;
    if (voice === null) return;
    retime(voice, this.#host.nowFor(voice), r, over);
    this.#host.changed(voice);
    this.#host.record('rate', () => this.ramp(r, over));
  }

  seek(elapsed: number): void {
    const voice = this.#voice;
    if (voice === null) return;
    voice.rebase(this.#host.nowFor(voice));
    voice.anchorElapsed = elapsed;
    voice.seeks++;
    this.#host.sought(voice);
    this.#host.changed(voice);
    this.#host.record('seek', () => this.seek(elapsed));
  }

  fade(opts?: FadeOptions<I>): void {
    const voice = this.#voice;
    if (voice === null) return;
    this.#host.fade(voice, opts);
    this.#host.record('fade', () => this.fade(opts));
  }

  rise(opts?: { over?: number }): void {
    const voice = this.#voice;
    if (voice === null) return;
    this.#host.rise(voice, opts);
    this.#host.record('rise', () => this.rise(opts));
  }

  weightOf(subject: I): number {
    const voice = this.#voice;
    return voice === null ? 0 : this.#host.weightOf(voice, subject);
  }
}
