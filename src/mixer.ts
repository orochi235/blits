import { type Curve, curve } from './easing.js';
import { type Built, builtOf, readKeys } from './patch.js';
import { Store } from './store.js';
import type {
  Channel,
  Engine,
  FadeOptions,
  FadeSpec,
  Handle,
  Kit,
  Mix,
  MixOptions,
  Patch,
  Setting,
  Signal,
  VoiceSpec,
} from './types.js';

type Key<O> = keyof O & string;

/** Everything one voice holds for one subject, so a probe makes one lookup per voice. */
interface Subject<S> {
  /** The voice's `target` answer, fixed on first sight. */
  reaches: boolean;
  /** The voice's `stagger` answer in voice ms, fixed on first sight. */
  delay: number;
  /** The mix timestamp this subject's delay ran out at, which its fade in counts from. */
  since: number;
  /** Left at rest during a handover, so it stops contributing. */
  rested: boolean;
  /** Per written channel, whether a rest-less influence is on: 0 unknown, 1 on, 2 off. */
  bands: Uint8Array;
  state: S;
  /** The `now` this subject last caught up to, for this voice. */
  stepped: number;
  /** The `now` this subject was last probed at, so twelve probes in a frame step once. */
  probed: number;
  /** The last delta computed this frame, handed back to a repeat probe unchanged. */
  delta: Record<string, unknown> | null;
  /** Stop 0 for a `from: 'current'` voice, taken the first frame this subject is seen. */
  base?: Record<string, unknown>;
  /** What each stateful signal on this voice keeps for this subject, by the signal. */
  kept: Map<object, unknown>;
  keep: Setting['keep'];
}

const keeper = (kept: Map<object, unknown>): Setting['keep'] =>
  function keep<K>(owner: object, init: () => K): K {
    if (kept.has(owner)) return kept.get(owner) as K;
    const made = init();
    kept.set(owner, made);
    return made;
  };

interface Ramp {
  from: number;
  at: number;
  over: number;
  rest: boolean;
  deadline?: number;
}

const near = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => near(v, b[i]));
  return a === b;
};

const copy = (v: unknown): unknown => (Array.isArray(v) ? [...v] : v);

class Voice<I, O> {
  state: 'pending' | 'live' | 'fading' | 'done' = 'pending';
  rate: number;
  weight: number;
  /** elapsed = anchorElapsed + (now − anchorNow) · rate, rebased on a rate change or a seek. */
  anchorNow: number;
  anchorElapsed = 0;
  out: Ramp | null = null;
  readonly subjects = new Store<I, Subject<unknown>>();
  /** Kit slot of each channel the patch writes, in `writes` order. */
  readonly slots: number[];
  /** The stops built ahead of time, for a `keys` patch. */
  readonly built: Built | null;
  readonly ease: Curve | undefined;
  /** Reused for every call this voice makes, so it is valid only during the call. */
  readonly setting: Setting<unknown>;
  /** Every subject this voice has been asked about, so a handover knows when it is finished. */
  seen = 0;
  restedCount = 0;
  resolve!: () => void;
  readonly done: Promise<void>;

  constructor(
    readonly id: number,
    readonly spec: VoiceSpec<I, O>,
    readonly patch: Patch<I, O, unknown>,
    readonly fade: FadeSpec,
    now: number,
    readonly start: number,
    slotOf: Map<string, number>,
    host: unknown,
  ) {
    this.slots = patch.writes.map((k) => slotOf.get(k as string) as number);
    this.built = patch.form === 'keys' && patch.keys ? builtOf(patch) : null;
    this.ease = fade.ease === undefined ? undefined : curve(fade.ease);
    this.setting = {
      timestamp: 0,
      dt: 0,
      elapsed: 0,
      pass: 0,
      weight: 0,
      state: undefined,
      host,
      keep: keeper(new Map()),
    };
    this.rate = spec.rate ?? 1;
    this.weight = typeof spec.weight === 'number' ? spec.weight : 1;
    this.anchorNow = start;
    this.done = new Promise((r) => {
      this.resolve = r;
    });
    if (now >= start) this.state = 'live';
  }

  elapsedAt(now: number): number {
    return this.anchorElapsed + (now - this.anchorNow) * this.rate;
  }

  rebase(now: number): void {
    this.anchorElapsed = this.elapsedAt(now);
    this.anchorNow = now;
  }
}

class Mixer<I, O> implements Mix<I, O> {
  private readonly voices: Voice<I, O>[] = [];
  private readonly pose = new Store<I, O>();
  private nextId = 1;
  /** The mix clock: the host's timestamp less every gap `rebase` has taken out. */
  private now = Number.NaN;
  private offset = 0;
  private last = Number.NaN;
  private rebasing = false;
  private wantsPose = false;
  /** Read once a sync, so a `reduce` function is not called per voice per subject. */
  private reducedNow = false;
  /** How many voices in the list carry a locus; with none, a fold allocates nothing. */
  private loci = 0;
  /** What `influence` and `peek` found besides the delta, read by the caller at once. */
  private w = 0;
  private h: Subject<unknown> | null = null;

  private readonly names: Key<O>[];
  private readonly channels: Channel<unknown>[];
  private readonly slotOf = new Map<string, number>();

  constructor(
    private readonly kit: Kit<O>,
    private readonly opts: MixOptions,
  ) {
    this.names = Object.keys(kit as object) as Key<O>[];
    this.channels = this.names.map((k) => kit[k] as Channel<unknown>);
    this.names.forEach((k, i) => {
      this.slotOf.set(k, i);
    });
  }

  private get reduced(): boolean {
    const r = this.opts.reduce;
    return typeof r === 'function' ? r() : r === true;
  }

  private get band(): { on: number; off: number } {
    return this.opts.band ?? { on: 0.6, off: 0.4 };
  }

  cue(spec: VoiceSpec<I, O>): Handle {
    const patch = spec.patch;
    const engine = this.opts.engine ?? mixer;
    if (!engine.runs.has(patch.form))
      throw new Error(`blits: engine ${engine.name} does not run ${patch.form} patches`);
    for (const channel of patch.writes)
      if (!(channel in (this.kit as object)))
        throw new Error(`blits: kit has no channel ${String(channel)}, which this patch writes`);
    if (spec.from === 'current' && patch.form !== 'keys')
      throw new Error("blits: from: 'current' needs a keys patch");

    const start =
      spec.start !== undefined ? spec.start - this.offset : Number.isNaN(this.now) ? 0 : this.now;
    const voice = new Voice<I, O>(
      this.nextId++,
      spec,
      patch,
      spec.fade ?? {},
      Number.isNaN(this.now) ? start : this.now,
      start,
      this.slotOf,
      this.opts.host,
    );
    this.voices.push(voice);
    if (spec.locus !== undefined) this.loci++;
    if (spec.from === 'current') this.wantsPose = true;
    return this.handle(voice);
  }

  blend(
    patches: readonly Patch<I, O, unknown>[],
    by: Signal<I>,
    spec: Omit<VoiceSpec<I, O>, 'patch' | 'weight' | 'locus'> = {},
  ): Handle[] {
    const locus = `blend:${this.nextId}`;
    const stops = patches.length - 1;
    return patches.map((patch, i) => {
      const share = (subject: I, setting: Setting) => {
        const k = by(subject, setting);
        const d = stops === 0 ? 0 : Math.abs(k * stops - i);
        return d >= 1 ? 0 : 1 - d;
      };
      const weight: Signal<I> = by.input ? Object.assign(share, { input: true }) : share;
      return this.cue({ ...spec, patch, weight, locus });
    });
  }

  sync(timestamp: number): void {
    if (this.rebasing && !Number.isNaN(this.last)) this.offset += timestamp - this.last;
    this.rebasing = false;
    this.last = timestamp;
    const now = timestamp - this.offset;
    if (now === this.now) return;
    this.now = now;
    this.reducedNow = this.reduced;
    for (const voice of this.voices) {
      if (voice.state === 'done') continue;
      if (voice.state === 'pending' && now >= voice.start) voice.state = 'live';
      const period = voice.patch.period;
      const loop = voice.spec.loop ?? true;
      const passes = loop === true ? Number.POSITIVE_INFINITY : loop === false ? 1 : loop;
      if (voice.state === 'live' && period > 0 && Number.isFinite(passes)) {
        if (voice.elapsedAt(now) >= period * passes) this.beginFade(voice, {});
      }
      if (voice.state === 'fading' && voice.out) {
        const { at, over, rest, deadline } = voice.out;
        const spent = now - at;
        if (rest) {
          const out = deadline !== undefined && spent >= deadline;
          const settled = voice.seen > 0 && voice.restedCount >= voice.seen;
          if (out || settled) this.retire(voice);
        } else if (spent >= over) this.retire(voice);
      }
    }
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i] as Voice<I, O>;
      if (voice.state === 'done') {
        this.voices.splice(i, 1);
        if (voice.spec.locus !== undefined) this.loci--;
      }
    }
  }

  probe(subject: I, out?: O): O {
    const pose = this.fold(subject, out);
    // Keeping last frame's pose is free when the mix allocated it; a host sampling into its own
    // object only pays for the copy once something in the mix has asked to retarget from it.
    if (out === undefined) this.pose.set(subject, pose);
    else if (this.wantsPose) {
      const kept = {} as O;
      for (const key of this.names) {
        const v = (pose as Record<string, unknown>)[key];
        if (v !== undefined) (kept as Record<string, unknown>)[key] = copy(v);
      }
      this.pose.set(subject, kept);
    }
    return pose;
  }

  atRest(subject: I): boolean {
    const pose = this.fold(subject, undefined, true);
    for (let i = 0; i < this.names.length; i++) {
      const channel = this.channels[i] as Channel<unknown>;
      const value = (pose as Record<string, unknown>)[this.names[i] as string];
      if (channel.rest === undefined) {
        if (value !== undefined) return false;
      } else if (!near(value, channel.rest)) return false;
    }
    return true;
  }

  rebase(): void {
    this.rebasing = true;
  }

  get live(): boolean {
    return this.voices.some((v) => v.state !== 'done');
  }

  mute(opts?: { over?: number }): void {
    for (const voice of this.voices) this.beginFade(voice, { over: opts?.over });
  }

  drop(subject: I): void {
    this.pose.delete(subject);
    for (const voice of this.voices) voice.subjects.delete(subject);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private handle(voice: Voice<I, O>): Handle {
    const mix = this;
    return {
      id: voice.id,
      get state() {
        return voice.state;
      },
      get weight() {
        return voice.weight;
      },
      set weight(w: number) {
        voice.weight = w;
      },
      get rate() {
        return voice.rate;
      },
      set rate(r: number) {
        voice.rebase(Number.isNaN(mix.now) ? voice.start : mix.now);
        voice.rate = r;
      },
      seek(elapsed: number) {
        voice.anchorNow = Number.isNaN(mix.now) ? voice.start : mix.now;
        voice.anchorElapsed = elapsed;
      },
      fade(opts?: FadeOptions) {
        mix.beginFade(voice, opts ?? {});
      },
      done: voice.done,
    };
  }

  private beginFade(voice: Voice<I, O>, opts: FadeOptions): void {
    if (voice.state === 'done' || voice.state === 'fading') return;
    const over = this.reduced ? 0 : (opts.over ?? voice.fade.out ?? 0);
    voice.state = 'fading';
    voice.out = {
      from: 1,
      at: Number.isNaN(this.now) ? voice.start : this.now,
      over,
      rest: opts.at === 'rest',
      deadline: opts.deadline,
    };
    if (over === 0 && opts.at !== 'rest') this.retire(voice);
  }

  private retire(voice: Voice<I, O>): void {
    voice.state = 'done';
    voice.resolve();
  }

  /** The ramp a voice's own fade envelope applies this frame, 0..1. */
  private envelope(voice: Voice<I, O>, now: number, since: number): number {
    const reduced = this.reducedNow;
    const ease = voice.ease;
    let w = 1;
    const fadeIn = voice.fade.in ?? 0;
    if (fadeIn > 0 && !reduced) {
      const u = (now - since) / fadeIn;
      if (u < 1) w *= ease ? ease(Math.max(0, u)) : Math.max(0, u);
    }
    const out = voice.out;
    if (out && !out.rest) {
      if (reduced || out.over === 0) return 0;
      const u = 1 - (now - out.at) / out.over;
      const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
      w *= ease ? ease(clamped) : clamped;
    }
    return w;
  }

  /** What this voice holds for this subject, made on first sight with `target` and `stagger` asked once. */
  private held(voice: Voice<I, O>, subject: I, now: number): Subject<unknown> {
    let held = voice.subjects.get(subject) as Subject<unknown> | undefined;
    if (held !== undefined) return held;
    const reaches = voice.spec.target ? voice.spec.target(subject) : true;
    const delay = reaches && voice.spec.stagger ? voice.spec.stagger(subject) : 0;
    // When the voice clock reads `delay`, from where it is anchored now.
    const since =
      voice.rate > 0
        ? voice.anchorNow + (delay - voice.anchorElapsed) / voice.rate
        : voice.start + delay;
    const kept = new Map<object, unknown>();
    held = {
      reaches,
      delay,
      since,
      rested: false,
      bands: new Uint8Array(voice.slots.length),
      state:
        reaches && voice.patch.state
          ? (voice.patch.state(subject) as unknown)
          : (undefined as unknown),
      stepped: now,
      probed: Number.NaN,
      delta: null,
      kept,
      keep: keeper(kept),
    };
    voice.subjects.set(subject, held);
    if (reaches) voice.seen++;
    return held;
  }

  /** The weight a voice gives a subject this frame, with the setting already filled in. */
  private weigh(voice: Voice<I, O>, subject: I, now: number, held: Subject<unknown>): number {
    const signal = typeof voice.spec.weight === 'function' ? voice.spec.weight : null;
    const raw =
      (signal ? signal(subject, voice.setting as Setting) : voice.weight) *
      this.envelope(voice, now, held.since);
    return raw < 0 ? 0 : raw > 1 ? 1 : raw;
  }

  /**
   * One voice's delta for one subject this frame, or null when it does not reach. Its weight and
   * the subject's record are left in `w` and `h`.
   */
  private influence(voice: Voice<I, O>, subject: I, now: number): Record<string, unknown> | null {
    if (voice.state === 'pending' || voice.state === 'done') return null;
    const held = this.held(voice, subject, now);
    if (!held.reaches) return null;
    if (voice.out?.rest && held.rested) return null;

    const elapsed = voice.elapsedAt(now) - held.delay;
    if (elapsed < 0) return null;

    const period = voice.patch.period;
    const loop = voice.spec.loop ?? true;
    const passes = loop === true ? Number.POSITIVE_INFINITY : loop === false ? 1 : loop;
    let phase = 0;
    let pass = 0;
    if (period > 0) {
      const done = Number.isFinite(passes) && elapsed >= period * passes;
      phase = done ? 1 : (elapsed % period) / period;
      pass = done ? passes - 1 : Math.floor(elapsed / period);
    }

    const setting = voice.setting;
    setting.timestamp = now;
    const gap = now - held.stepped;
    const cap = this.opts.maxDt;
    setting.dt = this.reducedNow
      ? Number.POSITIVE_INFINITY
      : cap !== undefined && gap > cap
        ? cap
        : gap;
    setting.elapsed = elapsed;
    setting.pass = pass;
    setting.weight = 0;
    setting.state = held.state;
    setting.keep = held.keep;

    const weight = this.weigh(voice, subject, now, held);
    setting.weight = weight;

    if (held.probed === now && held.delta) {
      this.w = weight;
      this.h = held;
      return held.delta;
    }

    if (voice.patch.step && held.probed !== now && now !== held.stepped) {
      voice.patch.step(held.state as never, setting.dt, subject, setting as Setting<never>);
      held.stepped = now;
    }

    let delta: Record<string, unknown>;
    if (voice.built) {
      let base: Record<string, unknown> | undefined;
      if (voice.spec.from === 'current') {
        if (held.base === undefined) held.base = this.baseFor(voice, subject);
        base = held.base;
      }
      delta = readKeys(voice.built, phase, held.delta ?? {}, base);
    } else {
      delta = voice.patch.at(phase, subject, setting as Setting<never>) as Record<string, unknown>;
    }
    held.delta = delta;
    held.probed = now;

    if (voice.out?.rest && this.isRest(delta)) {
      held.rested = true;
      voice.restedCount++;
      return null;
    }
    this.w = weight;
    this.h = held;
    return delta;
  }

  /**
   * Stop 0 for a retargeting voice: the subject's pose in the frame before this voice contributes.
   * With no such frame on record — a voice cued before the subject was ever probed, or a host that
   * samples into its own object — it is this frame's pose with every other voice folded in.
   */
  private baseFor(voice: Voice<I, O>, subject: I): Record<string, unknown> {
    let prior = this.pose.get(subject) as Record<string, unknown> | undefined;
    if (prior === undefined && !this.folding.has(voice.id)) {
      this.folding.add(voice.id);
      try {
        prior = this.fold(subject, undefined, false, voice.id) as Record<string, unknown>;
      } finally {
        this.folding.delete(voice.id);
      }
    }
    const base: Record<string, unknown> = {};
    for (const key of voice.patch.writes as Key<O>[]) {
      const channel = this.kit[key] as Channel<unknown>;
      const value = prior?.[key];
      const fallback = channel.rest;
      if (value !== undefined) base[key] = copy(value);
      else if (fallback !== undefined) base[key] = copy(fallback);
    }
    return base;
  }

  private isRest(delta: Record<string, unknown>): boolean {
    for (const key of Object.keys(delta) as Key<O>[]) {
      if (delta[key] === undefined) continue;
      const channel = this.kit[key] as Channel<unknown>;
      if (channel.rest === undefined) return false;
      if (!near(delta[key], channel.rest)) return false;
    }
    return true;
  }

  /** Folds a locus's members into one influence through each channel's own `lerp`. */
  private foldLocus(members: { delta: Record<string, unknown>; weight: number }[]): {
    delta: Record<string, unknown>;
    weight: number;
  } {
    let sum = 0;
    for (const m of members) sum += m.weight;
    const delta: Record<string, unknown> = {};
    if (sum <= 0) return { delta, weight: 0 };
    const taken = new Map<string, number>();
    for (const member of members) {
      if (member.weight <= 0) continue;
      for (const key of Object.keys(member.delta)) {
        if (member.delta[key] === undefined) continue;
        const channel = this.kit[key as Key<O>] as Channel<unknown>;
        const held = taken.get(key);
        if (held === undefined) {
          delta[key] = copy(member.delta[key]);
          taken.set(key, member.weight);
          continue;
        }
        const total = held + member.weight;
        delta[key] = channel.lerp(delta[key], member.delta[key], member.weight / total);
        taken.set(key, total);
      }
    }
    return { delta, weight: sum > 1 ? 1 : sum };
  }

  /** Whether a rest-less channel's influence is switched on, across a band rather than an edge. */
  private passes(was: boolean | undefined, w: number): boolean {
    const { on, off } = this.band;
    return w >= on ? true : w <= off ? false : (was ?? w >= on);
  }

  private readonly locusBands = new Store<I, Map<string, boolean>>();
  /** Voices whose stop 0 is mid-computation, so a fold for one cannot re-enter itself. */
  private readonly folding = new Set<number>();

  /** Folds one voice's delta into the pose, its band state kept on the subject's record. */
  private apply(
    pose: Record<string, unknown>,
    voice: Voice<I, O>,
    held: Subject<unknown>,
    delta: Record<string, unknown>,
    weight: number,
  ): void {
    const slots = voice.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as number;
      const key = this.names[slot] as string;
      const value = delta[key];
      if (value === undefined) continue;
      const channel = this.channels[slot] as Channel<unknown>;
      if (channel.rest !== undefined && channel.scale) {
        // pose[key] is the copy of rest this fold made, so it is ours to write into.
        pose[key] = channel.fold
          ? channel.fold(pose[key], value, weight)
          : channel.merge(pose[key], channel.scale(value, weight));
        continue;
      }
      const band = held.bands[i];
      const on = this.passes(band === 0 ? undefined : band === 1, weight);
      held.bands[i] = on ? 1 : 2;
      if (on) pose[key] = pose[key] === undefined ? copy(value) : channel.merge(pose[key], value);
    }
  }

  private fold(subject: I, out?: O, dry = false, except?: number): O {
    const now = this.now;
    const pose = (out ?? ({} as O)) as Record<string, unknown>;
    for (let i = 0; i < this.names.length; i++) {
      const rest = (this.channels[i] as Channel<unknown>).rest;
      const key = this.names[i] as string;
      // Never `delete`: it drops a reused out object into dictionary mode for good.
      if (rest !== undefined) pose[key] = copy(rest);
      else if (pose[key] !== undefined) pose[key] = undefined;
    }
    if (Number.isNaN(now)) return pose as O;

    if (this.loci === 0) {
      for (const voice of this.voices) {
        if (voice.id === except) continue;
        const delta = this.read(voice, subject, now, dry);
        if (delta === null || this.w <= 0) continue;
        this.apply(pose, voice, this.h as Subject<unknown>, delta, this.w);
      }
      return pose as O;
    }

    // With a locus in play, each one folds at its first member's place in the voice order.
    type Single = { voice: Voice<I, O>; held: Subject<unknown>; delta: Record<string, unknown> };
    const order: (Single | string)[] = [];
    const weights: number[] = [];
    const loci = new Map<string, { delta: Record<string, unknown>; weight: number }[]>();
    for (const voice of this.voices) {
      if (voice.id === except) continue;
      const delta = this.read(voice, subject, now, dry);
      if (delta === null) continue;
      const locus = voice.spec.locus;
      if (locus === undefined) {
        order.push({ voice, held: this.h as Subject<unknown>, delta });
        weights.push(this.w);
        continue;
      }
      const members = loci.get(locus);
      if (members) members.push({ delta, weight: this.w });
      else {
        loci.set(locus, [{ delta, weight: this.w }]);
        order.push(locus);
        weights.push(0);
      }
    }

    let bands = this.locusBands.get(subject);
    if (bands === undefined) {
      bands = new Map();
      this.locusBands.set(subject, bands);
    }

    for (let n = 0; n < order.length; n++) {
      const at = order[n] as Single | string;
      if (typeof at !== 'string') {
        if ((weights[n] as number) > 0)
          this.apply(pose, at.voice, at.held, at.delta, weights[n] as number);
        continue;
      }
      const { delta, weight } = this.foldLocus(
        loci.get(at) as { delta: Record<string, unknown>; weight: number }[],
      );
      if (weight <= 0) continue;
      for (const key of Object.keys(delta)) {
        const channel = this.kit[key as Key<O>] as Channel<unknown>;
        const value = delta[key];
        if (value === undefined) continue;
        if (channel.rest !== undefined && channel.scale) {
          // pose[key] is the copy of rest this fold made, so it is ours to write into.
          pose[key] = channel.fold
            ? channel.fold(pose[key], value, weight)
            : channel.merge(pose[key], channel.scale(value, weight));
          continue;
        }
        const band = `${at}:${key}`;
        const on = this.passes(bands.get(band), weight);
        bands.set(band, on);
        if (on) pose[key] = pose[key] === undefined ? copy(value) : channel.merge(pose[key], value);
      }
    }
    return pose as O;
  }

  /** `influence`, or for a dry fold a subject already probed this frame, without advancing it. */
  private read(
    voice: Voice<I, O>,
    subject: I,
    now: number,
    dry: boolean,
  ): Record<string, unknown> | null {
    if (dry) {
      const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
      if (held?.reaches && held.probed === now && held.delta) {
        const setting = voice.setting;
        setting.timestamp = now;
        setting.dt = 0;
        setting.elapsed = voice.elapsedAt(now);
        setting.pass = 0;
        setting.weight = 0;
        setting.state = held.state;
        setting.keep = held.keep;
        this.w = this.weigh(voice, subject, now, held);
        this.h = held;
        return held.delta;
      }
    }
    return this.influence(voice, subject, now);
  }
}

/** The one that ships: both forms on the CPU, probed per subject on demand. */
export const mixer: Engine = {
  name: 'mixer',
  runs: new Set<'fn' | 'keys'>(['fn', 'keys']),
  create<I, O>(kit: Kit<O>, opts: MixOptions): Mix<I, O> {
    return new Mixer<I, O>(kit, opts);
  },
};

export function mix<I, O>(kit: Kit<O>, opts: MixOptions = {}): Mix<I, O> {
  return (opts.engine ?? mixer).create<I, O>(kit, opts);
}
