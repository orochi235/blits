import { retime } from './clock.js';
import type { FadeOptions, Handle } from './types.js';
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

/** A voice's handle: the host's only way to control a voice once cued. */
export class VoiceHandle<I, O> implements Handle<I> {
  readonly id: number;
  readonly #voice: Voice<I, O>;
  readonly #host: HandleHost<I, O>;

  constructor(voice: Voice<I, O>, host: HandleHost<I, O>) {
    this.id = voice.id;
    this.#voice = voice;
    this.#host = host;
  }

  get state(): Handle<I>['state'] {
    return this.#voice.state;
  }

  get owner(): Handle<I> | undefined {
    return this.#voice.owner?.handle ?? undefined;
  }

  get played(): Promise<boolean> {
    return this.#voice.played;
  }

  get done(): Promise<void> {
    return this.#voice.done;
  }

  get weight(): number {
    return this.#voice.weight;
  }

  set weight(w: number) {
    this.#voice.weight = w;
    this.#host.changed(this.#voice);
    this.#host.record('weight', () => {
      this.weight = w;
    });
  }

  get rate(): number {
    return this.#voice.rateAt(this.#host.nowFor(this.#voice));
  }

  set rate(r: number) {
    this.ramp(r, 0);
  }

  ramp(r: number, over: number): void {
    const voice = this.#voice;
    retime(voice, this.#host.nowFor(voice), r, over);
    this.#host.changed(voice);
    this.#host.record('rate', () => this.ramp(r, over));
  }

  seek(elapsed: number): void {
    const voice = this.#voice;
    voice.rebase(this.#host.nowFor(voice));
    voice.anchorElapsed = elapsed;
    voice.seeks++;
    this.#host.sought(voice);
    this.#host.changed(voice);
    this.#host.record('seek', () => this.seek(elapsed));
  }

  fade(opts?: FadeOptions<I>): void {
    this.#host.fade(this.#voice, opts);
    this.#host.record('fade', () => this.fade(opts));
  }

  rise(opts?: { over?: number }): void {
    this.#host.rise(this.#voice, opts);
    this.#host.record('rise', () => this.rise(opts));
  }

  weightOf(subject: I): number {
    return this.#host.weightOf(this.#voice, subject);
  }
}
