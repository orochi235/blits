import type { Channel, Handle, Kit, Mix, VoiceSpec } from '@msb235/blits';
import { Param, PolySynth, Signal, type Synth, ToneAudioNode } from 'tone';
import type { Driven, Target } from './drive.js';

/** A Tone node wired to a mix, and the mix's subject for it. */
export interface Sound<N, I, O> {
  readonly node: N;
  /** Cues a voice on this sound alone; the spec names no `subjects`. */
  cue(spec: Omit<VoiceSpec<I, O>, 'subjects'>): Handle<I>;
  /**
   * A new node of the same class from this one's settings (`get()`), wired as a sound of its own:
   * no voices, no connections, nothing shared.
   */
  copy(): Sound<N, I, O>;
  /**
   * Ends the voices cued on it, unwires the node and drops the subject from the mix: its parameters go back to the values they
   * had when wired. The node stays the host's to disconnect and dispose.
   */
  drop(): void;
}

/** What `wire` needs of the driver it belongs to. */
export interface Bind<I, O> {
  readonly mix: Mix<I, O>;
  readonly kit: Kit<O> | undefined;
  seconds(): number;
  bind(subject: I, targets: Driven<O>[]): void;
  unbind(subject: I): void;
}

/** Nodes some live sound wires, across every driver: two would write the same parameters. */
const wired = new WeakSet<object>();

export function wire<I, O, N extends ToneAudioNode>(host: Bind<I, O>, node: N): Sound<N, I, O> {
  if (!(node instanceof ToneAudioNode))
    throw new TypeError('blits-tone: wire takes a Tone node, and that is not a Tone node');
  const kit = host.kit;
  if (kit === undefined) throw new Error('blits-tone: wire needs a kit, passed to drive as `kit`');
  if (wired.has(node)) throw new Error('blits-tone: that node is already wired');

  const bases: [
    string,
    Target & { setValueAtTime(value: number, time: number): unknown },
    number,
  ][] = [];
  const targets: Driven<O>[] = [];
  for (const name of Object.keys(kit) as (keyof O & string)[]) {
    const param = (node as unknown as Record<string, unknown>)[name];
    if (!(param instanceof Param || param instanceof Signal)) continue;
    const base = param.value as number;
    const rest = (kit[name] as Channel<unknown>).rest;
    const move = rest === 0 ? (v: number) => base + v : rest === 1 ? (v: number) => base * v : null;
    targets.push([name, param, move]);
    bases.push([name, param, base]);
  }

  let dropped = false;
  const cued = new Set<Handle<I>>();
  const sound: Sound<N, I, O> = {
    node,
    cue(spec) {
      if (dropped) throw new Error('blits-tone: that sound is dropped');
      if ('subjects' in spec)
        throw new Error('blits-tone: a sound names its own subject; cue it without `subjects`');
      const h = host.mix.cue({ ...spec, subjects: [sound as unknown as I] } as VoiceSpec<I, O>);
      cued.add(h);
      void h.done.then(() => cued.delete(h));
      return h;
    },
    copy() {
      const twin = remake(node);
      // `get()` reads each parameter as it plays now, voices included; the copy starts from the bases.
      const params = twin as unknown as Record<string, { value: number }>;
      for (const [name, , base] of bases) (params[name] as { value: number }).value = base;
      return wire(host, twin);
    },
    drop() {
      if (dropped) return;
      dropped = true;
      for (const h of cued) h.fade({ over: 0 });
      host.unbind(sound as unknown as I);
      wired.delete(node);
      const time = host.seconds();
      for (const [, param, base] of bases) {
        param.cancelAndHoldAtTime(time);
        param.setValueAtTime(base, time);
      }
      host.mix.drop(sound as unknown as I);
    },
  };
  host.bind(sound as unknown as I, targets);
  wired.add(node);
  return sound;
}

/**
 * A new node of `node`'s class from its settings. A `PolySynth`'s `get()` is its voices' settings,
 * so its own (the voice class, `maxPolyphony`, `volume`) are carried across by hand.
 */
function remake<N extends ToneAudioNode>(node: N): N {
  if (node instanceof PolySynth) {
    const voice = (node as unknown as { voice: typeof Synth }).voice;
    return new PolySynth({
      voice,
      maxPolyphony: node.maxPolyphony,
      volume: node.volume.value,
      options: node.get() as never,
    }) as unknown as N;
  }
  const make = node.constructor as new (options: unknown) => N;
  return new make(node.get());
}
