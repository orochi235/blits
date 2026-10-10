import { retime } from './clock.js';
import { type Motion, motionOf, type Value } from './motion.js';
import { leave } from './origin.js';
import type { Doubt, FadeOptions, FitResult, Handle, SeekOptions } from './types.js';
import type { Voice } from './voice.js';

/** What a voice's handle asks of the mix that cued it: one per mix, shared by every handle. */
export interface HandleHost<I, O> {
  /** The mix clock, or its owner's for a voice one holds; the voice's start before either reads. */
  nowFor(voice: Voice<I, O>): number;
  /** A handle write changed the voice: reschedule it, and refill the lanes. */
  changed(voice: Voice<I, O>): void;
  /**
   * The voice's clock jumped: for an owner, so did every clock it holds. With `rebuild`, their
   * state is made again for where they now are. How sure that leaves it.
   */
  sought(voice: Voice<I, O>, rebuild: boolean): Doubt;
  fade(voice: Voice<I, O>, opts: FadeOptions<I> | undefined): void;
  rise(voice: Voice<I, O>, opts: { over?: number } | undefined): void;
  weightOf(voice: Voice<I, O>, subject: I): number;
  /** Records a write the host made, which `again` makes once more where a seek replays it. */
  record(label: string, again: () => void): void;
}

/** Refuses a voice rate no clock can run at. */
export function finiteRate(rate: number): void {
  if (!Number.isFinite(rate))
    throw new RangeError(`blits: a voice's rate is a finite number, not ${rate}`);
}

/** Refuses a voice weight that is no number: NaN would fold into every channel the voice writes. */
export function plainWeight(weight: number): void {
  if (Number.isNaN(weight)) throw new RangeError('blits: a voice’s weight is a number, not NaN');
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
  get result(): FitResult | undefined {
    return this.#voice?.fitting?.report;
  }

  get weight(): number {
    return this.#voice?.weight ?? this.#gone?.weight ?? 0;
  }

  // A write to a paged voice changes nothing: it had left when the host made it, as it has on replay.
  set weight(w: number) {
    plainWeight(w);
    const voice = this.#voice;
    if (voice === null) return;
    voice.written = true;
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
    finiteRate(r);
    const voice = this.#voice;
    if (voice === null) return;
    voice.written = true;
    const now = this.#host.nowFor(voice);
    // A pending voice's clock reads 0 at its start, and a rate taken from now would cross 0 sooner:
    // a subject it freezes before would play, and step, ahead of a voice that has not started.
    const u = voice.state === 'pending' && voice.start > now && r > 0 ? voice.start : now;
    leave(voice, u);
    retime(voice, u, r, over);
    this.#host.changed(voice);
    this.#host.record('rate', () => this.ramp(r, over));
  }

  seek(elapsed: number, opts?: SeekOptions): Doubt {
    const voice = this.#voice;
    if (voice === null) return 'exact';
    voice.written = true;
    const u = this.#host.nowFor(voice);
    leave(voice, u);
    voice.rebase(u);
    voice.anchorElapsed = elapsed;
    voice.seeks++;
    const doubt = this.#host.sought(voice, opts?.state !== 'keep');
    this.#host.changed(voice);
    this.#host.record('seek', () => this.seek(elapsed, opts));
    return doubt;
  }

  fade(opts?: FadeOptions<I>): void {
    const voice = this.#voice;
    if (voice === null) return;
    voice.written = true;
    this.#host.fade(voice, opts);
    this.#host.record('fade', () => this.fade(opts));
  }

  rise(opts?: { over?: number }): void {
    const voice = this.#voice;
    if (voice === null) return;
    voice.written = true;
    this.#host.rise(voice, opts);
    this.#host.record('rise', () => this.rise(opts));
  }

  weightOf(subject: I): number {
    const voice = this.#voice;
    return voice === null ? 0 : this.#host.weightOf(voice, subject);
  }

  // The patch records each of these itself, so a seek plays them again without the handle.
  to(subject: I, target: Value, at?: number): void {
    const voice = this.#voice;
    if (voice !== null) moves(voice.patch, 'to', 'a spring or a tween').to(subject, target, at);
  }

  push(subject: I, velocity: Value, at?: number): void {
    const voice = this.#voice;
    if (voice !== null)
      moves(voice.patch, 'push', 'a spring or a glide').push(subject, velocity, at);
  }

  read(subject: I, at?: number): Motion<Value> | undefined {
    const voice = this.#voice;
    if (voice === null || motionOf(voice.patch) === undefined) return undefined;
    return (voice.patch as unknown as Moves<I>).read(subject, at);
  }
}

/** What a motion patch may be asked through its voice's handle; each kind has `read` and one or both of the rest. */
interface Moves<I> {
  to(subject: I, target: Value, at?: number): void;
  push(subject: I, velocity: Value, at?: number): void;
  read(subject: I, at?: number): Motion<Value> | undefined;
}

/** A voice's patch as a motion that takes `verb`, or a throw naming the kinds that do. */
function moves<I>(patch: object, verb: 'to' | 'push', kinds: string): Moves<I> {
  if (motionOf(patch) === undefined || typeof (patch as Partial<Moves<I>>)[verb] !== 'function')
    throw new Error(`blits: ${verb} needs a voice playing ${kinds}`);
  return patch as Moves<I>;
}
