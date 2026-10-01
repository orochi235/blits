import { type Curve, curve } from './easing.js';
import { type Built, builtOf, readKeys } from './patch.js';
import { reading } from './reading.js';
import { Store } from './store.js';
import type {
  Channel,
  Doubt,
  Engine,
  FadeOptions,
  FadeSpec,
  Handle,
  Kit,
  Mark,
  Marked,
  Mix,
  MixOptions,
  Patch,
  Placement,
  Projection,
  Query,
  Sent,
  Setting,
  Signal,
  VoiceSpec,
} from './types.js';

// Every runtime blits targets has it; the package's lib setting names no environment.
declare function structuredClone<T>(value: T): T;

type Key<O> = keyof O & string;

const none: readonly string[] = Object.freeze([]);

/** Everything one voice holds for one subject, so a probe makes one lookup per voice. */
interface Subject<S> {
  /** The voice's `target` answer, fixed on first sight. */
  reaches: boolean;
  /** The voice's `stagger` answer in voice ms, fixed on first sight. */
  delay: number;
  /** The mix timestamp this subject's delay ran out at, which its fade in counts from. */
  since: number;
  /** The weight this voice gave this subject the last frame it was probed, 0 where it gave none. */
  weight: number;
  /** Left at rest during a handover, so it stops contributing. */
  rested: boolean;
  /** Per written channel, whether a rest-less influence is on: 0 unknown, 1 on, 2 off. */
  bands: Uint8Array;
  state: S;
  /** The `now` this subject last caught up to, for this voice. */
  stepped: number;
  /** Under `stepMs`, how many intervals have run since `since`; `stepped` is where that lands. */
  ticks: number;
  /** The `now` this subject was last probed at, so twelve probes in a frame step once. */
  probed: number;
  /** The last delta computed this frame, handed back to a repeat probe unchanged. */
  delta: Record<string, unknown> | null;
  /** Stop 0 for a `from: 'current'` voice, taken the first frame this subject is seen. */
  base?: Record<string, unknown>;
  /** The pose's velocity per channel at that moment, units per ms, so the first segment leaves at it. */
  slope?: Record<string, unknown>;
  /** What each stateful signal on this voice keeps for this subject, by the signal. */
  kept: Map<object, unknown>;
  keep: Setting['keep'];
  /** Under `history`, copies of this record by the mix time they were taken, oldest first. */
  snaps?: { at: number; held: Subject<S> }[];
  /** In a projection: where this record started from, and whether nothing known could be. */
  from?: number;
  unknown?: boolean;
}

const keeper = (kept: Map<object, unknown>): Setting['keep'] =>
  function keep<K>(owner: object, init: () => K): K {
    if (kept.has(owner)) return kept.get(owner) as K;
    const made = init();
    kept.set(owner, made);
    return made;
  };

/** What sets a voice's clock: its rate, and where it was last anchored. */
interface Clock {
  anchorNow: number;
  anchorElapsed: number;
  rate: number;
  ramp: { from: number; to: number; over: number } | null;
}

/** A voice's clock, weight and fade from one mix time on, kept under `history`. */
interface Controls extends Clock {
  at: number;
  weight: number;
  out: Ramp | null;
}

function elapsedWith(c: Clock, now: number): number {
  const dt = now - c.anchorNow;
  const r = c.ramp;
  if (r === null) return c.anchorElapsed + dt * c.rate;
  if (dt <= 0) return c.anchorElapsed + dt * r.from;
  const d = r.to - r.from;
  if (dt <= r.over) return c.anchorElapsed + r.from * dt + (d * dt * dt) / (2 * r.over);
  return c.anchorElapsed + r.from * r.over + (d * r.over) / 2 + r.to * (dt - r.over);
}

/**
 * The last entry taken before `t`, or at it where `inclusive`. A control change made in a frame is
 * taken strictly: it shows from the next frame on, as it did live.
 */
function last<T extends { at: number }>(
  list: readonly T[],
  t: number,
  inclusive: boolean,
): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  let found: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = list[mid] as T;
    if (e.at < t || (inclusive && e.at === t)) {
      found = e;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** A store that fills a missing entry from `make` on first ask. */
class Filled<K, V> extends Store<K, V> {
  constructor(private readonly make: (key: K) => V | undefined) {
    super();
  }

  override get(key: K): V | undefined {
    let v = super.get(key);
    if (v === undefined) {
      v = this.make(key);
      if (v !== undefined) super.set(key, v);
    }
    return v;
  }
}

const noSend = (): void => {};

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
  /**
   * elapsed = anchorElapsed + the rate integrated from anchorNow, rebased on a rate change or a seek.
   * Without a ramp the rate is constant; with one it moves linearly from `from` to `to` over `over`
   * mix ms starting at the anchor, and holds `to` after.
   */
  anchorNow: number;
  anchorElapsed = 0;
  ramp: { from: number; to: number; over: number } | null = null;
  out: Ramp | null = null;
  readonly subjects = new Store<I, Subject<unknown>>();
  /** Kit slot of each channel the patch writes, in `writes` order. */
  readonly slots: number[];
  /** The stops built ahead of time, for a `keys` patch. */
  readonly built: Built | null;
  /** The kit's `lerp` for each channel the patch writes, which keyed stops interpolate through. */
  readonly lerps: Channel<unknown>['lerp'][];
  readonly ease: Curve | undefined;
  /** Reused for every call this voice makes, so it is valid only during the call. */
  readonly setting: Setting<unknown>;
  /** Every subject this voice has been asked about, so a handover knows when it is finished. */
  seen = 0;
  /** The longest stagger of any subject seen, so a finite loop waits for the last of them. */
  latest = 0;
  restedCount = 0;
  /** The mix time it was cued at; -Infinity before the first sync. */
  cuedAt = Number.NEGATIVE_INFINITY;
  /** The mix time it left at. */
  doneAt = Number.POSITIVE_INFINITY;
  /** Under `history`, its controls after each change, oldest first. */
  log: Controls[] | null = null;
  /** Where an anchored `out` or `end` puts its fade's start, mix time; Infinity until known. */
  outAt = Number.POSITIVE_INFINITY;
  /** Whether its start is still to be fixed by an anchor, so it waits pending. */
  placing = false;
  resolve!: () => void;
  readonly done: Promise<void>;

  constructor(
    readonly id: number,
    readonly spec: VoiceSpec<I, O>,
    readonly patch: Patch<I, O, unknown>,
    readonly fade: FadeSpec,
    now: number,
    public start: number,
    slotOf: Map<string, number>,
    channels: readonly Channel<unknown>[],
    host: unknown,
    send: (event: unknown) => void,
  ) {
    this.slots = patch.writes.map((k) => slotOf.get(k as string) as number);
    this.built = patch.form === 'keys' && patch.keys ? builtOf(patch) : null;
    this.lerps = this.slots.map((slot) => (channels[slot] as Channel<unknown>).lerp);
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
      send,
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
    return elapsedWith(this, now);
  }

  /** The mix time its clock reads `elapsed`, inverting `elapsedAt`; Infinity where it never will. */
  timeAt(elapsed: number): number {
    const e0 = this.anchorElapsed;
    const r = this.ramp;
    if (r === null) {
      if (this.rate > 0) return this.anchorNow + (elapsed - e0) / this.rate;
      return elapsed <= e0 ? this.anchorNow : Number.POSITIVE_INFINITY;
    }
    if (elapsed <= e0)
      return r.from > 0 ? this.anchorNow + (elapsed - e0) / r.from : this.anchorNow;
    const a = (r.to - r.from) / (2 * r.over);
    const atEnd = e0 + r.from * r.over + a * r.over * r.over;
    if (elapsed <= atEnd) {
      const c = e0 - elapsed;
      const dt =
        Math.abs(a) < 1e-12
          ? -c / r.from
          : (-r.from + Math.sqrt(Math.max(0, r.from * r.from - 4 * a * c))) / (2 * a);
      return this.anchorNow + dt;
    }
    if (r.to <= 0) return Number.POSITIVE_INFINITY;
    return this.anchorNow + r.over + (elapsed - atEnd) / r.to;
  }

  /** Records this voice's controls as they stand, from mix time `at`. */
  note(at: number): void {
    this.log?.push({
      at,
      anchorNow: this.anchorNow,
      anchorElapsed: this.anchorElapsed,
      rate: this.rate,
      ramp: this.ramp,
      weight: this.weight,
      out: this.out,
    });
  }

  /**
   * A copy for a projection: its own setting, which sends nothing, and its own per-subject records,
   * filled from `fill`. With `controls` it takes those, as the voice stood at an earlier time.
   */
  copy(fill: (subject: I) => Subject<unknown> | undefined, controls?: Controls): Voice<I, O> {
    const v = Object.assign(Object.create(Voice.prototype), this) as Voice<I, O>;
    const w = v as unknown as Record<string, unknown>;
    w.subjects = new Filled<I, Subject<unknown>>(fill);
    w.setting = { ...this.setting, keep: keeper(new Map()), send: noSend };
    v.log = null;
    if (controls) {
      v.anchorNow = controls.anchorNow;
      v.anchorElapsed = controls.anchorElapsed;
      v.rate = controls.rate;
      v.ramp = controls.ramp;
      v.weight = controls.weight;
      v.out = controls.out;
    }
    v.resolve = noSend;
    return v;
  }

  rateAt(now: number): number {
    const r = this.ramp;
    if (r === null) return this.rate;
    const u = (now - this.anchorNow) / r.over;
    return u >= 1 ? r.to : u <= 0 ? r.from : r.from + (r.to - r.from) * u;
  }

  /** Moves the anchor to `now`, carrying what is left of a ramp. */
  rebase(now: number): void {
    const rate = this.rateAt(now);
    this.anchorElapsed = this.elapsedAt(now);
    const r = this.ramp;
    if (r !== null) {
      const left = this.anchorNow + r.over - now;
      this.ramp = left > 0 ? { from: rate, to: r.to, over: left } : null;
    }
    this.anchorNow = now;
  }
}

class Mixer<I, O> implements Mix<I, O> {
  private voices: Voice<I, O>[] = [];
  /** Under `history`, voices that have left but that a read back may still reach. */
  private gone: Voice<I, O>[] = [];
  /** Set on a projection's own mixer: it sends nothing, keeps no history, and reads without committing. */
  private projecting = false;
  /** Set on a projection reading back: a subject it has nothing on starts from its voice's start. */
  private backward = false;
  /** Each subject's last two poses and when they were probed, for `from: 'current'`. */
  private pose = new Store<I, { pose: O; at: number; prev: O | undefined; prevAt: number }>();
  private nextId = 1;
  /** The mix clock: the host's timestamp less every gap `rebase` has taken out. */
  private now = Number.NaN;
  private offset = 0;
  private last = Number.NaN;
  private rebasing = false;
  private wantsPose = false;
  /** Read once a sync, so a `reduce` function is not called per voice per subject. */
  private reducedNow = false;
  /**
   * Per subject, the voices that may reach it, in voice order, so a probe walks those rather than
   * every voice: a voice targeted at one subject is asked about that subject alone. Rebuilt when
   * `version` moves, which is whenever the list or a voice's pending state changes.
   */
  private readonly reach = new Store<I, { version: number; voices: Voice<I, O>[] }>();
  private version = 0;
  /** How many voices in the list carry a `target`; with none, every voice reaches every subject. */
  private targeted = 0;
  /** How many voices in the list carry a locus; with none, a fold allocates nothing. */
  private loci = 0;
  /** How many voices in the list are anchored, so a sync with none skips placing them. */
  private anchored = 0;
  /** Events sent since the last drain, and who is being probed, so `send` knows whose they are. */
  private sent: Sent<I, unknown>[] = [];
  private sending: { voice: Voice<I, O> | null; subject: I } = {
    voice: null,
    subject: undefined as I,
  };
  private readonly send = (event: unknown): void => {
    const { voice, subject } = this.sending;
    if (voice === null || this.projecting) return;
    this.sent.push({
      timestamp: voice.setting.timestamp,
      subject,
      voice: voice.id,
      tags: voice.spec.tags ?? none,
      event,
    });
  };
  /** What `influence` and `peek` found besides the delta, read by the caller at once. */
  private w = 0;
  private h: Subject<unknown> | null = null;

  private readonly names: Key<O>[];
  private readonly channels: Channel<unknown>[];
  /** Slots of the channels that declare bounds, clamped after every fold. */
  private readonly bounded: number[];
  private readonly slotOf = new Map<string, number>();

  constructor(
    private readonly kit: Kit<O>,
    private readonly opts: MixOptions,
  ) {
    this.names = Object.keys(kit as object) as Key<O>[];
    this.channels = this.names.map((k) => kit[k] as Channel<unknown>);
    this.bounded = this.channels.flatMap((c, i) => (c.bounds ? [i] : []));
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

  cue(spec: VoiceSpec<I, O>): Handle<I> {
    const patch = spec.patch;
    const engine = this.opts.engine ?? mixer;
    if (!engine.runs.has(patch.form))
      throw new Error(`blits: engine ${engine.name} does not run ${patch.form} patches`);
    for (const channel of patch.writes) {
      if (!(channel in (this.kit as object)))
        throw new Error(`blits: kit has no channel ${String(channel)}, which this patch writes`);
      const wanted = patch.kit?.[channel] as Channel<unknown> | undefined;
      const here = this.kit[channel] as Channel<unknown>;
      if (wanted && wanted !== here && (wanted.kind === undefined || wanted.kind !== here.kind))
        throw new Error(
          `blits: channel ${String(channel)} is ${here.kind ?? 'a custom channel'} in this kit, but the patch was written for ${wanted.kind ?? 'a custom channel'}`,
        );
    }
    if (patch.reads) {
      const host = this.opts.host;
      for (const field of patch.reads)
        if (typeof host !== 'object' || host === null || !(field in host))
          throw new Error(`blits: the patch reads host.${field}, which this mix's host lacks`);
    }
    if (spec.from === 'current' && patch.form !== 'keys')
      throw new Error("blits: from: 'current' needs a keys patch");
    const anchor = spec.anchor;
    if (anchor) this.checkPlacement(spec, anchor);

    const placed = anchor !== undefined && (anchor.start !== undefined || anchor.in !== undefined);
    const start = placed
      ? Number.POSITIVE_INFINITY
      : spec.start !== undefined
        ? spec.start - this.offset
        : Number.isNaN(this.now)
          ? 0
          : this.now;
    const voice = new Voice<I, O>(
      this.nextId++,
      spec,
      patch,
      spec.fade ?? {},
      this.now,
      start,
      this.slotOf,
      this.channels,
      this.opts.host,
      this.send,
    );
    if (!Number.isNaN(this.now)) voice.cuedAt = this.now;
    voice.placing = placed;
    if (this.opts.history) {
      voice.log = [];
      voice.note(Number.NEGATIVE_INFINITY);
    }
    this.voices.push(voice);
    this.version++;
    if (spec.target !== undefined) this.targeted++;
    if (spec.locus !== undefined) this.loci++;
    if (spec.from === 'current') this.wantsPose = true;
    if (anchor) {
      this.anchored++;
      this.place();
      if (!Number.isNaN(this.now) && voice.state === 'pending' && this.now >= voice.start) {
        voice.state = 'live';
        this.version++;
      }
    }
    return this.handle(voice);
  }

  blend(
    patches: readonly Patch<I, O, unknown>[],
    by: Signal<I>,
    spec: Omit<VoiceSpec<I, O>, 'patch' | 'weight' | 'locus'> = {},
  ): Handle<I>[] {
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
    this.move(now);
  }

  /** Moves the mix clock to `now`: voices start, finite loops end, and fades finish. */
  private move(now: number): void {
    this.now = now;
    this.reducedNow = this.reduced;
    if (this.anchored > 0) this.place();
    for (const voice of this.voices) {
      if (voice.state === 'done') continue;
      if (voice.state === 'live' && voice.outAt <= now)
        this.beginFade(voice, {}, Math.max(voice.start, voice.outAt));
      if (voice.state === 'pending' && now >= voice.start) {
        voice.state = 'live';
        this.version++;
      }
      const period = voice.patch.period;
      const loop = voice.spec.loop ?? true;
      const passes = loop === true ? Number.POSITIVE_INFINITY : loop === false ? 1 : loop;
      if (voice.state === 'live' && period > 0 && Number.isFinite(passes)) {
        const end = period * passes + voice.latest;
        // The fade starts when the last pass ended, not at the frame that noticed, so it plays the
        // same at any frame rate and a read at another time can find it.
        if (voice.elapsedAt(now) >= end)
          this.beginFade(voice, {}, Math.max(voice.start, Math.min(now, voice.timeAt(end))));
      }
      if (voice.state === 'fading' && voice.out) {
        const { at, over, rest, deadline } = voice.out;
        const spent = now - at;
        if (rest) {
          const out = deadline !== undefined && spent >= deadline;
          const settled = voice.seen > 0 && voice.restedCount >= voice.seen;
          if (out) this.retire(voice, at + (deadline as number));
          else if (settled) this.retire(voice);
        } else if (spent >= over) this.retire(voice, at + over);
      }
    }
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i] as Voice<I, O>;
      if (voice.state === 'done') {
        this.voices.splice(i, 1);
        if (this.opts.history) this.gone.push(voice);
        this.version++;
        if (voice.spec.target !== undefined) this.targeted--;
        if (voice.spec.locus !== undefined) this.loci--;
        if (voice.spec.anchor !== undefined) this.anchored--;
      }
    }
    const history = this.opts.history;
    if (history && this.gone.length > 0) {
      const reach = now - history.ms;
      this.gone = this.gone.filter((v) => v.doneAt >= reach);
    }
  }

  probe(subject: I, out?: O): O {
    const pose = this.fold(subject, out);
    // Keeping last frame's pose is free when the mix allocated it; a host sampling into its own
    // object only pays for the copy once something in the mix has asked to retarget from it.
    let kept: O | undefined;
    if (out === undefined) kept = pose;
    else if (this.wantsPose) {
      kept = {} as O;
      for (const key of this.names) {
        const v = (pose as Record<string, unknown>)[key];
        if (v !== undefined) (kept as Record<string, unknown>)[key] = copy(v);
      }
    }
    if (kept !== undefined) {
      const rec = this.pose.get(subject);
      if (rec === undefined)
        this.pose.set(subject, { pose: kept, at: this.now, prev: undefined, prevAt: Number.NaN });
      else if (rec.at === this.now) rec.pose = kept;
      else {
        rec.prev = rec.pose;
        rec.prevAt = rec.at;
        rec.pose = kept;
        rec.at = this.now;
      }
    }
    return pose;
  }

  project(timestamp: number): Projection<I, O> {
    const t = timestamp - this.offset;
    const c = new Mixer<I, O>(this.kit, { ...this.opts, history: undefined });
    c.projecting = true;
    c.pose = this.pose;
    c.offset = this.offset;
    c.wantsPose = this.wantsPose;
    c.nextId = this.nextId;
    c.reducedNow = this.reducedNow;
    if (Number.isNaN(this.now) || t >= this.now) {
      c.now = this.now;
      c.voices = this.voices
        .filter((v) => v.state !== 'done')
        .map((v) => v.copy((subject) => this.carry(v, subject)));
      c.count();
      c.move(t);
    } else {
      const history = this.opts.history;
      if (!history) throw new Error('blits: reading back needs a mix made with history');
      if (t < this.now - history.ms)
        throw new Error(`blits: ${timestamp} is older than this mix's history reaches`);
      c.now = t;
      c.backward = true;
      c.voices = [...this.voices, ...this.gone]
        .filter((v) => v.cuedAt <= t && v.doneAt > t)
        .sort((a, b) => a.id - b.id)
        .map((v) => {
          const log = v.log as Controls[];
          const copy = v.copy(
            (subject) => this.recall(v, subject, t),
            last(log, t, false) ?? (log[0] as Controls),
          );
          copy.state = t < v.start ? 'pending' : copy.out && copy.out.at <= t ? 'fading' : 'live';
          return copy;
        });
      c.count();
    }
    const read = <T>(f: () => T): T => {
      reading.live = false;
      try {
        return f();
      } finally {
        reading.live = true;
      }
    };
    return {
      timestamp,
      probe: (subject, out) => read(() => c.fold(subject, out)),
      assess: (subject) =>
        read(() => {
          c.fold(subject);
          return c.doubts(subject);
        }),
    };
  }

  marks(from: number, to: number): Marked[] {
    const lo = from - this.offset;
    const hi = to - this.offset;
    const out: Marked[] = [];
    for (const voice of [...this.voices, ...this.gone]) {
      for (const mark of ['start', 'in', 'out', 'end'] as const) {
        const t = this.markOf(voice, mark);
        if (t === undefined || t < lo || t > hi) continue;
        out.push({
          timestamp: t + this.offset,
          mark,
          voice: voice.id,
          name: voice.spec.name,
          tags: voice.spec.tags ?? none,
        });
      }
    }
    return out.sort((a, b) => a.timestamp - b.timestamp || a.voice - b.voice);
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
    this.reach.delete(subject);
    for (const voice of this.voices) voice.subjects.delete(subject);
    for (const voice of this.gone) voice.subjects.delete(subject);
  }

  drain<E = unknown>(tag?: string): Sent<I, E>[] {
    const all = this.sent;
    if (all.length === 0) return [];
    let out = all;
    if (tag === undefined) this.sent = [];
    else {
      out = [];
      const kept: Sent<I, unknown>[] = [];
      for (const e of all) (e.tags.includes(tag) ? out : kept).push(e);
      this.sent = kept;
    }
    return out.sort((a, b) => a.timestamp - b.timestamp) as Sent<I, E>[];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Refuses a placement that names a mark twice on one side, or that waits on itself. */
  private checkPlacement(spec: VoiceSpec<I, O>, anchor: Placement): void {
    if (anchor.start !== undefined && anchor.in !== undefined)
      throw new Error('blits: a placement anchors start or in, not both');
    if (anchor.out !== undefined && anchor.end !== undefined)
      throw new Error('blits: a placement anchors out or end, not both');
    if (spec.start !== undefined && (anchor.start !== undefined || anchor.in !== undefined))
      throw new Error('blits: a voice takes start or an anchored start, not both');
    const name = spec.name;
    if (name === undefined) return;
    const names = (p: Placement): string[] =>
      [p.start, p.in, p.out, p.end].flatMap((a) => {
        if (a === undefined || typeof a === 'number') return [];
        const q = 'of' in a ? a.of : 'after' in a ? a.after : 'with' in a ? a.with : a.before;
        const n = typeof q === 'string' ? q : q.name;
        return n === undefined ? [] : [n];
      });
    const seen = new Set<string>();
    const waits = [...names(anchor)];
    while (waits.length > 0) {
      const n = waits.pop() as string;
      if (n === name) throw new Error(`blits: ${name}'s placement waits on itself`);
      if (seen.has(n)) continue;
      seen.add(n);
      for (const v of this.voices)
        if (v.spec.name === n && v.spec.anchor) waits.push(...names(v.spec.anchor));
    }
  }

  /**
   * Fixes every anchored voice's start and out from what its anchors answer now. A start is fixed
   * while the voice waits and an out until its fade begins; a target that has left keeps the time it
   * last gave. Repeated so a chain of anchors settles in one sync.
   */
  private place(): void {
    for (let round = 0; round <= this.voices.length; round++) {
      let moved = false;
      for (const voice of this.voices) {
        const anchor = voice.spec.anchor;
        if (anchor === undefined || voice.state === 'done') continue;
        if (voice.placing && voice.state === 'pending') {
          const by = anchor.start ?? anchor.in;
          const t = by === undefined ? undefined : this.resolve(by, voice);
          if (t !== undefined) {
            const start = anchor.start !== undefined ? t : t - (voice.fade.in ?? 0);
            if (start !== voice.start) {
              voice.start = start;
              voice.anchorNow = start;
              voice.anchorElapsed = 0;
              moved = true;
            }
          }
        }
        if (voice.state !== 'fading') {
          const by = anchor.out ?? anchor.end;
          const t = by === undefined ? undefined : this.resolve(by, voice);
          if (t !== undefined) {
            const at = anchor.out !== undefined ? t : t - (voice.fade.out ?? 0);
            if (at !== voice.outAt) {
              voice.outAt = at;
              moved = true;
            }
          }
        }
      }
      if (!moved) return;
    }
  }

  /** The mix time an anchor answers, or undefined while its target has none. */
  private resolve(
    a: number | NonNullable<Placement['start']>,
    self: Voice<I, O>,
  ): number | undefined {
    if (typeof a === 'number') return a - this.offset;
    let query: string | Query;
    let mark: Mark;
    let by = a.by ?? 0;
    if ('of' in a) {
      query = a.of;
      mark = a.mark;
    } else if ('after' in a) {
      query = a.after;
      mark = 'end';
    } else if ('with' in a) {
      query = a.with;
      mark = 'start';
    } else {
      query = a.before;
      mark = 'start';
      by = -by;
    }
    const target = this.select(typeof query === 'string' ? { name: query } : query, mark, self);
    if (target === undefined) return undefined;
    const t = this.markOf(target, mark);
    return t === undefined ? undefined : t + by;
  }

  /** The voice a query picks, among those cued and those that have left, never the asker. */
  private select(q: Query, mark: Mark, self: Voice<I, O>): Voice<I, O> | undefined {
    const all = [...this.gone, ...this.voices].filter(
      (v) =>
        v !== self &&
        (q.name === undefined || v.spec.name === q.name) &&
        (q.tag === undefined || (v.spec.tags ?? none).includes(q.tag)) &&
        (q.writes === undefined || (v.patch.writes as readonly unknown[]).includes(q.writes)),
    );
    if (all.length === 0) return undefined;
    all.sort((a, b) => a.id - b.id);
    const resolver = q.resolver ?? 'last';
    if (resolver === 'first') return all[0];
    if (resolver === 'last') return all[all.length - 1];
    const timed = all.flatMap((v) => {
      const t = this.markOf(v, mark);
      return t === undefined ? [] : [{ v, t }];
    });
    if (resolver === 'next') {
      const now = Number.isNaN(this.now) ? Number.NEGATIVE_INFINITY : this.now;
      const ahead = timed.filter((e) => e.t >= now).sort((a, b) => a.t - b.t);
      return ahead[0]?.v;
    }
    timed.sort((a, b) => a.t - b.t);
    return (resolver === 'earliest' ? timed[0] : timed[timed.length - 1])?.v;
  }

  /** When a voice reaches a mark, mix time, or undefined while nothing has fixed it. */
  private markOf(voice: Voice<I, O>, mark: Mark): number | undefined {
    const start = voice.start;
    if (!Number.isFinite(start)) return undefined;
    if (mark === 'start') return start;
    if (mark === 'in') return start + (voice.fade.in ?? 0);
    const out = voice.out;
    let outAt: number | undefined;
    if (out !== null) outAt = out.at;
    else if (Number.isFinite(voice.outAt)) outAt = voice.outAt;
    else {
      const period = voice.patch.period;
      const loop = voice.spec.loop ?? true;
      const passes = loop === true ? Number.POSITIVE_INFINITY : loop === false ? 1 : loop;
      if (period > 0 && Number.isFinite(passes)) {
        const t = voice.timeAt(period * passes + voice.latest);
        if (Number.isFinite(t)) outAt = Math.max(start, t);
      }
    }
    if (mark === 'out') return voice.state === 'done' && outAt === undefined ? voice.doneAt : outAt;
    if (voice.state === 'done') return voice.doneAt;
    if (out !== null) {
      if (out.rest) return out.deadline === undefined ? undefined : out.at + out.deadline;
      return out.at + out.over;
    }
    return outAt === undefined ? undefined : outAt + (this.reduced ? 0 : (voice.fade.out ?? 0));
  }

  /** A voice's elapsed at an earlier mix time, by the controls it had then. */
  private elapsedThen(voice: Voice<I, O>, t: number): number {
    const log = voice.log;
    const c = log === null ? undefined : last(log, t, true);
    return elapsedWith(c ?? voice, t);
  }

  /** Records a change to a voice's controls under `history`, and lets go of what it no longer reaches. */
  private noted(voice: Voice<I, O>): void {
    const log = voice.log;
    if (log === null) return;
    voice.note(Number.isNaN(this.now) ? Number.NEGATIVE_INFINITY : this.now);
    const reach = this.now - (this.opts.history as { ms: number }).ms;
    let drop = 0;
    while (drop + 1 < log.length && (log[drop + 1] as Controls).at <= reach) drop++;
    if (drop > 0) log.splice(0, drop);
  }

  /** Recounts what the fold's shortcuts depend on, for a projection's freshly copied voices. */
  private count(): void {
    this.targeted = this.voices.filter((v) => v.spec.target !== undefined).length;
    this.loci = this.voices.filter((v) => v.spec.locus !== undefined).length;
    this.anchored = this.voices.filter((v) => v.spec.anchor !== undefined).length;
    this.version++;
  }

  /** A copy of a subject's record that shares nothing a read could change. */
  private copyHeld(voice: Voice<I, O>, h: Subject<unknown>): Subject<unknown> {
    const kept = new Map<object, unknown>();
    for (const [owner, value] of h.kept) kept.set(owner, structuredClone(value));
    const patch = voice.patch;
    return {
      ...h,
      bands: h.bands.slice(),
      state:
        h.state === undefined
          ? undefined
          : patch.clone
            ? patch.clone(h.state)
            : structuredClone(h.state),
      kept,
      keep: keeper(kept),
      probed: Number.NaN,
      delta: null,
      base: h.base === undefined ? undefined : structuredClone(h.base),
      slope: h.slope === undefined ? undefined : structuredClone(h.slope),
      snaps: undefined,
    };
  }

  /** A projection ahead starts each subject from where the live mix holds it. */
  private carry(voice: Voice<I, O>, subject: I): Subject<unknown> | undefined {
    const live = voice.subjects.get(subject) as Subject<unknown> | undefined;
    if (live === undefined) return undefined;
    const h = this.copyHeld(voice, live);
    h.from = h.stepped;
    return h;
  }

  /**
   * A projection back starts each subject from the latest copy kept at or before `t`, else from its
   * voice's start with fresh state, which is exact for a voice stepped at a fixed interval.
   */
  private recall(voice: Voice<I, O>, subject: I, t: number): Subject<unknown> | undefined {
    const live = voice.subjects.get(subject) as Subject<unknown> | undefined;
    if (live === undefined) return undefined;
    const snap = live.snaps && last(live.snaps, t, true);
    if (snap) {
      const h = this.copyHeld(voice, snap.held);
      h.from = h.stepped;
      return h;
    }
    const kept = new Map<object, unknown>();
    const stepped = live.since < t ? live.since : t;
    return {
      reaches: live.reaches,
      delay: live.delay,
      since: live.since,
      weight: 0,
      rested: false,
      bands: new Uint8Array(voice.slots.length),
      state:
        live.reaches && voice.patch.state
          ? (voice.patch.state(subject) as unknown)
          : (undefined as unknown),
      stepped,
      ticks: 0,
      probed: Number.NaN,
      delta: null,
      kept,
      keep: keeper(kept),
      from: stepped,
      unknown: voice.spec.from === 'current',
    };
  }

  /** Under `history`, keeps a copy of a stateful voice's record for this subject every so often. */
  private remember(voice: Voice<I, O>, held: Subject<unknown>): void {
    const history = this.opts.history;
    if (!history || this.projecting) return;
    if (voice.patch.step === undefined && held.kept.size === 0 && held.base === undefined) return;
    const snaps = held.snaps ?? [];
    held.snaps = snaps;
    const prev = snaps[snaps.length - 1];
    if (prev !== undefined && this.now - prev.at < (history.every ?? 200)) return;
    snaps.push({ at: this.now, held: this.copyHeld(voice, held) });
    const reach = this.now - history.ms;
    while (snaps.length > 1 && (snaps[1] as { at: number }).at <= reach) snaps.shift();
  }

  /** Per channel, the least sure voice that fed it this frame. */
  private doubts(subject: I): { [K in keyof O]-?: Doubt } {
    const out = {} as Record<string, Doubt>;
    for (const name of this.names) out[name] = 'exact';
    const rank = { exact: 0, stepped: 1, held: 2 } as const;
    for (const voice of this.reaching(subject, this.now)) {
      if (voice.state === 'pending' || voice.state === 'done') continue;
      const held = voice.subjects.get(subject) as Subject<unknown> | undefined;
      if (!held?.reaches || held.weight <= 0) continue;
      const d = this.doubtOf(voice, held);
      for (const slot of voice.slots) {
        const name = this.names[slot] as string;
        if (rank[d] > rank[out[name] as Doubt]) out[name] = d;
      }
    }
    return out as { [K in keyof O]-?: Doubt };
  }

  private doubtOf(voice: Voice<I, O>, held: Subject<unknown>): Doubt {
    const weight = voice.spec.weight;
    if (held.unknown) return 'held';
    if (typeof weight === 'function' && weight.input) return 'held';
    if (voice.patch.reads !== undefined && voice.patch.reads.length > 0) return 'held';
    if (this.now > (held.from ?? this.now)) {
      const tick = this.opts.stepMs;
      const fixed = tick !== undefined && tick > 0 && !this.reducedNow;
      if ((voice.patch.step && !fixed) || held.kept.size > 0) return 'stepped';
    }
    return 'exact';
  }

  private handle(voice: Voice<I, O>): Handle<I> {
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
        mix.noted(voice);
      },
      get rate() {
        return voice.rateAt(Number.isNaN(mix.now) ? voice.start : mix.now);
      },
      set rate(r: number) {
        voice.rebase(Number.isNaN(mix.now) ? voice.start : mix.now);
        voice.ramp = null;
        voice.rate = r;
        mix.noted(voice);
      },
      ramp(r: number, over: number) {
        const now = Number.isNaN(mix.now) ? voice.start : mix.now;
        voice.rebase(now);
        const from = voice.rateAt(now);
        voice.ramp = over > 0 && r !== from ? { from, to: r, over } : null;
        voice.rate = r;
        mix.noted(voice);
      },
      seek(elapsed: number) {
        voice.rebase(Number.isNaN(mix.now) ? voice.start : mix.now);
        voice.anchorElapsed = elapsed;
        mix.noted(voice);
      },
      fade(opts?: FadeOptions) {
        mix.beginFade(voice, opts ?? {});
      },
      weightOf(subject: I) {
        if (voice.state === 'done') return 0;
        return (voice.subjects.get(subject) as Subject<unknown> | undefined)?.weight ?? 0;
      },
      done: voice.done,
    };
  }

  private beginFade(voice: Voice<I, O>, opts: FadeOptions, at?: number): void {
    if (voice.state === 'done' || voice.state === 'fading') return;
    const over = this.reduced ? 0 : (opts.over ?? voice.fade.out ?? 0);
    voice.state = 'fading';
    voice.out = {
      from: 1,
      at: at ?? (Number.isNaN(this.now) ? voice.start : this.now),
      over,
      rest: opts.at === 'rest',
      deadline: opts.deadline,
    };
    this.noted(voice);
    if (over === 0 && opts.at !== 'rest') this.retire(voice, voice.out.at);
  }

  /** Removes a voice, recording that it left at `at`, default now. */
  private retire(voice: Voice<I, O>, at?: number): void {
    voice.state = 'done';
    voice.doneAt = at ?? (Number.isNaN(this.now) ? Number.NEGATIVE_INFINITY : this.now);
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
    // When the voice clock reads `delay`, from where it is anchored now; during a ramp this assumes
    // the rate it is ramping to.
    const since =
      voice.rate > 0
        ? voice.anchorNow + (delay - voice.anchorElapsed) / voice.rate
        : voice.start + delay;
    const kept = new Map<object, unknown>();
    held = {
      reaches,
      delay,
      since,
      weight: 0,
      rested: false,
      bands: new Uint8Array(voice.slots.length),
      state:
        reaches && voice.patch.state
          ? (voice.patch.state(subject) as unknown)
          : (undefined as unknown),
      stepped: this.backward && since < now ? since : now,
      ticks: 0,
      probed: Number.NaN,
      delta: null,
      kept,
      keep: keeper(kept),
    };
    if (this.projecting) {
      held.from = held.stepped;
      held.unknown = this.backward && voice.spec.from === 'current';
    }
    voice.subjects.set(subject, held);
    if (reaches) voice.seen++;
    if (delay > voice.latest) voice.latest = delay;
    return held;
  }

  /** The weight a voice gives a subject this frame, with the setting already filled in. */
  private weigh(voice: Voice<I, O>, subject: I, now: number, held: Subject<unknown>): number {
    this.sending.voice = voice;
    this.sending.subject = subject;
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
    held.weight = 0;
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
    held.weight = weight;

    if (held.probed === now && held.delta) {
      this.w = weight;
      this.h = held;
      return held.delta;
    }

    const history = this.opts.history;
    reading.horizon =
      history === undefined
        ? Number.POSITIVE_INFINITY
        : this.elapsedThen(voice, now - history.ms) - held.delay;

    const tick = this.opts.stepMs;
    if (voice.patch.step && held.probed !== now) {
      if (tick !== undefined && tick > 0 && !this.reducedNow) this.tick(voice, subject, held, tick);
      else if (now !== held.stepped) {
        voice.patch.step(held.state as never, setting.dt, subject, setting as Setting<never>);
        held.stepped = now;
      }
    }

    let delta: Record<string, unknown>;
    if (voice.built) {
      let base: Record<string, unknown> | undefined;
      if (voice.spec.from === 'current') {
        if (held.base === undefined) {
          held.base = this.baseFor(voice, subject);
          held.slope = this.slopeFor(voice, subject);
        }
        base = held.base;
      }
      delta = readKeys(
        voice.built,
        phase,
        held.delta ?? {},
        base,
        voice.lerps as never,
        held.slope,
      );
    } else {
      delta = voice.patch.at(phase, subject, setting as Setting<never>) as Record<string, unknown>;
    }
    held.delta = delta;
    held.probed = now;
    if (history !== undefined) this.remember(voice, held);

    if (voice.out?.rest && this.isRest(delta)) {
      held.weight = 0;
      held.rested = true;
      voice.restedCount++;
      return null;
    }
    this.w = weight;
    this.h = held;
    return delta;
  }

  /**
   * Runs `step` once per whole interval between where this subject last stopped and now, on a grid
   * counted from when its delay ran out, and leaves the remainder for the next sample. Counting
   * rather than adding keeps the grid where it is however many samples it is reached through.
   */
  private tick(voice: Voice<I, O>, subject: I, held: Subject<unknown>, tick: number): void {
    const now = this.now;
    const setting = voice.setting;
    const frameDt = setting.dt;
    let n = held.ticks;
    // The epsilon keeps an interval like 1000 / 120 from landing a hair short of a whole count.
    const due = Math.floor((now - held.since) / tick + 1e-9);
    const cap = this.opts.maxDt;
    if (cap !== undefined) {
      const most = Math.floor(cap / tick);
      if (due - n > most) n = due - most;
    }
    const step = voice.patch.step as NonNullable<Patch<I, O, unknown>['step']>;
    setting.dt = tick;
    for (n++; n <= due; n++) {
      setting.timestamp = held.since + n * tick;
      step(held.state as never, tick, subject, setting as Setting<never>);
    }
    held.ticks = due > held.ticks ? due : held.ticks;
    held.stepped = held.since + held.ticks * tick;
    setting.timestamp = now;
    setting.dt = frameDt;
  }

  /**
   * Stop 0 for a retargeting voice: the subject's pose in the frame before this voice contributes.
   * With no such frame on record — a voice cued before the subject was ever probed, or a host that
   * samples into its own object — it is this frame's pose with every other voice folded in.
   */
  private baseFor(voice: Voice<I, O>, subject: I): Record<string, unknown> {
    let prior = this.pose.get(subject)?.pose as Record<string, unknown> | undefined;
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

  /**
   * How fast each numeric channel this voice writes was moving, from the subject's last two probed
   * poses, in units per ms. Undefined with fewer than two on record, which starts the voice at rest.
   */
  private slopeFor(voice: Voice<I, O>, subject: I): Record<string, unknown> | undefined {
    const rec = this.pose.get(subject);
    if (rec?.prev === undefined || !(rec.at > rec.prevAt)) return undefined;
    const dt = rec.at - rec.prevAt;
    const now = rec.pose as Record<string, unknown>;
    const before = rec.prev as Record<string, unknown>;
    const slope: Record<string, unknown> = {};
    for (const key of voice.patch.writes as Key<O>[]) {
      const a = before[key];
      const b = now[key];
      if (typeof a === 'number' && typeof b === 'number') slope[key] = (b - a) / dt;
      else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length)
        slope[key] = b.map((v, i) => ((v as number) - (a[i] as number)) / dt);
    }
    return slope;
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

  /**
   * The voices that may reach this subject. A live voice is asked once, through the record it keeps
   * for the subject anyway; a pending one is kept until it goes live, since `target` is asked on
   * first sight, and sight only comes once a voice plays.
   */
  private reaching(subject: I, now: number): Voice<I, O>[] {
    if (this.targeted === 0) return this.voices;
    const held = this.reach.get(subject);
    if (held !== undefined && held.version === this.version) return held.voices;
    const voices: Voice<I, O>[] = [];
    for (const voice of this.voices) {
      if (voice.state === 'done') continue;
      if (voice.state === 'pending' || this.held(voice, subject, now).reaches) voices.push(voice);
    }
    this.reach.set(subject, { version: this.version, voices });
    return voices;
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

  /** Clamps every bounded channel of a folded pose into its range, in place. */
  private clamp(pose: Record<string, unknown>): Record<string, unknown> {
    for (const slot of this.bounded) {
      const [lo, hi] = (this.channels[slot] as Channel<unknown>).bounds as readonly [
        number,
        number,
      ];
      const key = this.names[slot] as string;
      const v = pose[key];
      if (typeof v === 'number') pose[key] = v < lo ? lo : v > hi ? hi : v;
      else if (Array.isArray(v))
        for (let i = 0; i < v.length; i++) {
          const x = v[i] as number;
          v[i] = x < lo ? lo : x > hi ? hi : x;
        }
    }
    return pose;
  }

  private fold(subject: I, out?: O, dry = false, except?: number): O {
    const pose = this.folded(subject, out, dry, except) as Record<string, unknown>;
    return (this.bounded.length === 0 ? pose : this.clamp(pose)) as O;
  }

  private folded(subject: I, out?: O, dry = false, except?: number): O {
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

    const voices = this.reaching(subject, now);
    if (this.loci === 0) {
      for (const voice of voices) {
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
    for (const voice of voices) {
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

/**
 * The one that ships: both forms on the CPU, probed per subject on demand.
 *
 * @category engine
 */
export const mixer: Engine = {
  name: 'mixer',
  runs: new Set<'fn' | 'keys'>(['fn', 'keys']),
  create<I, O>(kit: Kit<O>, opts: MixOptions): Mix<I, O> {
    return new Mixer<I, O>(kit, opts);
  },
};

/**
 * Makes a mix over a kit, on the engine the options name or the stock one.
 *
 * @category mix
 */
export function mix<I, O>(kit: Kit<O>, opts: MixOptions = {}): Mix<I, O> {
  return (opts.engine ?? mixer).create<I, O>(kit, opts);
}
