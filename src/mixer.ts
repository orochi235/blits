import { evalKeys, keysOptionsOf } from './patch.js';
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

interface Subject<S> {
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
  readonly reaches = new Store<I, boolean>();
  readonly rested = new Store<I, true>();
  readonly bands = new Map<string, boolean>();
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
  ) {
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
  private now = Number.NaN;
  private wantsPose = false;

  constructor(
    private readonly kit: Kit<O>,
    private readonly opts: MixOptions,
  ) {}

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

    const start = spec.start ?? (Number.isNaN(this.now) ? 0 : this.now);
    const voice = new Voice<I, O>(
      this.nextId++,
      spec,
      patch,
      spec.fade ?? {},
      Number.isNaN(this.now) ? start : this.now,
      start,
    );
    this.voices.push(voice);
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
    const now = timestamp;
    if (now === this.now) return;
    this.now = now;
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
      if (voice.state === 'done') this.voices.splice(i, 1);
    }
  }

  probe(subject: I, out?: O): O {
    const pose = this.fold(subject, out);
    // Keeping last frame's pose is free when the mix allocated it; a host sampling into its own
    // object only pays for the copy once something in the mix has asked to retarget from it.
    if (out === undefined) this.pose.set(subject, pose);
    else if (this.wantsPose) {
      const kept = {} as O;
      for (const key of Object.keys(this.kit as object) as Key<O>[]) {
        const v = (pose as Record<string, unknown>)[key];
        if (v !== undefined) (kept as Record<string, unknown>)[key] = copy(v);
      }
      this.pose.set(subject, kept);
    }
    return pose;
  }

  atRest(subject: I): boolean {
    const pose = this.fold(subject, undefined, true);
    for (const key of Object.keys(this.kit as object) as Key<O>[]) {
      const channel = this.kit[key] as Channel<unknown>;
      const value = (pose as Record<string, unknown>)[key];
      if (channel.rest === undefined) {
        if (value !== undefined) return false;
      } else if (!near(value, channel.rest)) return false;
    }
    return true;
  }

  get live(): boolean {
    return this.voices.some((v) => v.state !== 'done');
  }

  mute(opts?: { over?: number }): void {
    for (const voice of this.voices) this.beginFade(voice, { over: opts?.over });
  }

  drop(subject: I): void {
    this.pose.delete(subject);
    for (const voice of this.voices) {
      voice.subjects.delete(subject);
      voice.reaches.delete(subject);
      voice.rested.delete(subject);
    }
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
  private envelope(voice: Voice<I, O>, now: number): number {
    const reduced = this.reduced;
    let w = 1;
    const fadeIn = voice.fade.in ?? 0;
    if (fadeIn > 0 && !reduced) {
      const u = (now - voice.start) / fadeIn;
      if (u < 1) w *= voice.fade.ease ? voice.fade.ease(Math.max(0, u)) : Math.max(0, u);
    }
    const out = voice.out;
    if (out && !out.rest) {
      if (reduced || out.over === 0) return 0;
      const u = 1 - (now - out.at) / out.over;
      const clamped = u < 0 ? 0 : u > 1 ? 1 : u;
      w *= voice.fade.ease ? voice.fade.ease(clamped) : clamped;
    }
    return w;
  }

  private reaches(voice: Voice<I, O>, subject: I): boolean {
    const known = voice.reaches.get(subject);
    if (known !== undefined) return known;
    const answer = voice.spec.target ? voice.spec.target(subject) : true;
    voice.reaches.set(subject, answer);
    return answer;
  }

  /** One voice's delta for one subject this frame, with its weight. Null when it does not reach. */
  private influence(
    voice: Voice<I, O>,
    subject: I,
    now: number,
  ): { delta: Record<string, unknown>; weight: number } | null {
    if (voice.state === 'pending' || voice.state === 'done') return null;
    if (!this.reaches(voice, subject)) return null;
    if (voice.out?.rest && voice.rested.has(subject)) return null;

    let held = voice.subjects.get(subject) as Subject<unknown> | undefined;
    if (held === undefined) {
      const kept = new Map<object, unknown>();
      held = {
        state: voice.patch.state ? (voice.patch.state(subject) as unknown) : (undefined as unknown),
        stepped: now,
        probed: Number.NaN,
        delta: null,
        kept,
        keep: keeper(kept),
      };
      voice.subjects.set(subject, held);
      voice.seen++;
    }

    const delay = voice.spec.stagger ? voice.spec.stagger(subject) : 0;
    const elapsed = voice.elapsedAt(now) - delay;
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

    const setting: Setting<unknown> = {
      timestamp: now,
      dt: this.reduced ? Number.POSITIVE_INFINITY : now - held.stepped,
      elapsed,
      pass,
      weight: 0,
      state: held.state,
      host: this.opts.host,
      keep: held.keep,
    };

    const base = voice.weight;
    const signal = typeof voice.spec.weight === 'function' ? voice.spec.weight : null;
    const raw = (signal ? signal(subject, setting as Setting) : base) * this.envelope(voice, now);
    const weight = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    setting.weight = weight;

    if (held.probed === now && held.delta) return { delta: held.delta, weight };

    if (voice.patch.step && held.probed !== now && now !== held.stepped) {
      voice.patch.step(held.state as never, setting.dt, subject, setting as Setting<never>);
      held.stepped = now;
    }

    let delta: Record<string, unknown>;
    if (voice.spec.from === 'current' && voice.patch.keys) {
      if (held.base === undefined) held.base = this.baseFor(voice, subject);
      delta = evalKeys(
        voice.patch.keys,
        voice.patch.writes,
        phase,
        period,
        keysOptionsOf(voice.patch) ?? {},
        held.base as never,
      ) as Record<string, unknown>;
    } else {
      delta = voice.patch.at(phase, subject, setting as Setting<never>) as Record<string, unknown>;
    }
    held.delta = delta;
    held.probed = now;

    if (voice.out?.rest && this.isRest(delta)) {
      voice.rested.set(subject, true);
      voice.restedCount++;
      return null;
    }
    return { delta, weight };
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
  private passes(bands: Map<string, boolean>, at: string, w: number): boolean {
    const { on, off } = this.band;
    const was = bands.get(at) ?? w >= on;
    const now = w >= on ? true : w <= off ? false : was;
    bands.set(at, now);
    return now;
  }

  private readonly locusBands = new Store<I, Map<string, boolean>>();
  /** Voices whose stop 0 is mid-computation, so a fold for one cannot re-enter itself. */
  private readonly folding = new Set<number>();

  private fold(subject: I, out?: O, dry = false, except?: number): O {
    const now = this.now;
    const pose = (out ?? ({} as O)) as Record<string, unknown>;
    for (const key of Object.keys(this.kit as object) as Key<O>[]) {
      const channel = this.kit[key] as Channel<unknown>;
      if (channel.rest !== undefined) pose[key] = copy(channel.rest);
    }
    if (Number.isNaN(now)) return pose as O;

    const singles: { voice: Voice<I, O> | null; delta: Record<string, unknown>; weight: number }[] =
      [];
    const loci = new Map<string, { delta: Record<string, unknown>; weight: number }[]>();
    const order: (string | number)[] = [];

    for (const voice of this.voices) {
      if (voice.id === except) continue;
      const got = dry && voice.subjects.has(subject) ? this.peek(voice, subject, now) : null;
      const influence = got ?? this.influence(voice, subject, now);
      if (!influence) continue;
      const locus = voice.spec.locus;
      if (locus === undefined) {
        singles.push({ voice, ...influence });
        order.push(voice.id);
      } else {
        const held = loci.get(locus);
        if (held) held.push(influence);
        else {
          loci.set(locus, [influence]);
          order.push(locus);
        }
      }
    }

    let bands = this.locusBands.get(subject);
    if (bands === undefined) {
      bands = new Map();
      this.locusBands.set(subject, bands);
    }

    for (const at of order) {
      const entry =
        typeof at === 'number'
          ? singles.find((s) => s.voice?.id === at)
          : {
              voice: null,
              ...this.foldLocus(loci.get(at) as { delta: never; weight: number }[]),
            };
      if (!entry) continue;
      const { delta, weight } = entry;
      if (weight <= 0) continue;
      for (const key of Object.keys(delta) as Key<O>[]) {
        const channel = this.kit[key] as Channel<unknown>;
        const value = delta[key];
        if (value === undefined) continue;
        if (channel.rest !== undefined && channel.scale) {
          pose[key] = channel.merge(pose[key], channel.scale(value, weight));
        } else if (this.passes(bands, `${at}:${key}`, weight)) {
          pose[key] = pose[key] === undefined ? copy(value) : channel.merge(pose[key], value);
        }
      }
    }
    return pose as O;
  }

  /** A read that must not advance anything: what `atRest` asks between samples. */
  private peek(
    voice: Voice<I, O>,
    subject: I,
    now: number,
  ): { delta: Record<string, unknown>; weight: number } | null {
    const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
    if (!held || held.probed !== now || !held.delta) return null;
    return { delta: held.delta, weight: this.weightOf(voice, subject, now, held) };
  }

  private weightOf(voice: Voice<I, O>, subject: I, now: number, held: Subject<unknown>): number {
    const setting: Setting<unknown> = {
      timestamp: now,
      dt: 0,
      elapsed: voice.elapsedAt(now),
      pass: 0,
      weight: 0,
      state: held.state,
      host: this.opts.host,
      keep: held.keep,
    };
    const signal = typeof voice.spec.weight === 'function' ? voice.spec.weight : null;
    const raw =
      (signal ? signal(subject, setting as Setting) : voice.weight) * this.envelope(voice, now);
    return raw < 0 ? 0 : raw > 1 ? 1 : raw;
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
