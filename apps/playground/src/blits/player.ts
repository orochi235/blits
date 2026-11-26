import type { Doubt, Handle, Mix, Patch } from '@msb235/blits';
import { type Built, close } from './compile';
import type { Level } from './composition';
import { EventLog } from './events';
import { movedElsewhere } from './follow';
import { COLOR_AXES, type Mixed } from './kit';
import { messageOf } from './spec';
import type { Subject } from './stage';

export interface Columns {
  offset: Float64Array;
  turn: Float64Array;
  scale: Float64Array;
  color: Float64Array;
  opacity: Float64Array;
  glow: Float64Array;
}

/** How much history the picked subject keeps, ms of score time. */
export const WINDOW = 3000;

/** The picked subject at one frame: the mix's pose, each voice's solo pose, each voice's and group's `weightOf`. */
interface Sample {
  t: number;
  full: Mixed;
  solos: ReadonlyMap<string, Mixed>;
  weights: ReadonlyMap<string, number>;
}

export interface History {
  picked: number | null;
  samples: readonly Sample[];
}

/** A probe's pose, copied: probes write into a pose the mix reuses. */
export const copied = (p: Mixed): Mixed => ({
  ...p,
  offset: [...p.offset],
  ...(p.color ? { color: [...p.color] } : {}),
});

/**
 * Pulls `m`'s frame into `out`, and gives what it threw on a value it cannot pull, or null. A mix
 * that throws leaves `out` holding the last frame.
 */
export function tryPull(
  m: Mix<Subject, Mixed>,
  subjects: readonly Subject[],
  out: Columns,
): string | null {
  try {
    m.pull(subjects, out);
    return null;
  } catch (err) {
    return messageOf(err);
  }
}

/**
 * How the player moves back: `replay` rebuilds and plays again from 0 what the host did, syncing at
 * the same times, so a scrub shows what playback showed; `seek` calls blits' `seek`, which restores
 * from history and is as sure as it says.
 */
export type SeekBy = 'replay' | 'seek';

/**
 * One thing the host did to the transport, and the mix time it left: what a replay does again.
 * Live changes to voices are not among them, so a replay drops those. A `land` is a frame whose
 * clock something else moved, such as the debug panel's hold: a replay syncs it at host time `at`
 * with the gap taken out, then seeks to `to`, where the frame showed the mix.
 */
type Act =
  | { kind: 'sync'; at: number }
  | { kind: 'land'; at: number; to: number }
  | { kind: 'rate'; rate: number; over: number }
  | { kind: 'rebase' }
  | { kind: 'seek'; to: number };
type Op = Act & { now: number };

/** A gap between two syncs longer than this, ms, is a stall (a hidden tab), which `rebase` takes out. */
const STALL_MS = 250;

export class Player {
  built: Built;
  /** Where the score stands: the transport's mix time, never below 0. */
  t = 0;
  // Score ms of the loops played before this one, so the plots run on past a lap instead of starting over.
  private lapped = 0;
  seekBy: SeekBy = 'seek';
  /** What the full mix booked and sent since it was last built. */
  readonly events = new EventLog();
  readonly columns: Columns;
  // What the host did since the transport was made, which a replay does again; cut back on a seek back.
  private ops: Op[] = [];
  // Host time at the last sync; it only goes forward, even across a seek.
  private lastHost = 0;
  // Where the transport's clock stood after the player's last sync of it; null before the first.
  private lastNow: number | null = null;
  private follows = false;
  // A rebase waits in the transport until the next sync, whatever ops come between.
  private rebased = false;
  private readonly scratch: Columns;
  // Slider moves outlive a rebuild: a replay plays them at their current value.
  private readonly slid = new Map<string, number>();
  private authored: Map<string, number> | null = null;
  private isLive = false;
  // Where the stage's pointer last was, in dots, which a rebuild's `around` circles start at.
  private at: { x: number; y: number } | null = null;
  private picked: number | null = null;
  private samples: Sample[] = [];
  private history: History = { picked: null, samples: [] };
  private readonly listeners = new Set<() => void>();
  private isListed: boolean;

  static columnsFor(n: number): Columns {
    return {
      offset: new Float64Array(n * 2),
      turn: new Float64Array(n),
      scale: new Float64Array(n),
      color: new Float64Array(n * COLOR_AXES),
      opacity: new Float64Array(n),
      glow: new Float64Array(n),
    };
  }

  constructor(
    /** Compiles the composition; `listed` says whether its mixes go on the debug panel's list. */
    private readonly build: (listed: boolean) => Built,
    readonly subjects: readonly Subject[],
    /**
     * The composition's levels; `from`, a player this one replaces, hands over its sliders, what
     * its host did, and its booker tag. `listed: false` keeps its mixes off the debug panel until
     * `list(true)`, for a player made during a render, which React may throw away.
     */
    init?: { levels: readonly Level[]; from?: Player | null; listed?: boolean },
  ) {
    this.isListed = init?.listed ?? true;
    this.columns = Player.columnsFor(subjects.length);
    this.scratch = Player.columnsFor(subjects.length);
    const from = init?.from;
    if (from) {
      this.at = from.at;
      this.events.tag = from.events.tag;
      for (const [name, v] of from.slid) this.slid.set(name, v);
      this.authored = from.authored && new Map(from.authored);
      this.seekBy = from.seekBy;
    }
    if (init) this.author(init.levels);
    this.built = this.fresh();
    if (from) this.replay(from.ops, from.t, from.lastHost);
    else this.apply({ kind: 'sync', at: 0 });
    this.emit();
  }

  /**
   * Puts the mixes on the debug panel's list, rebuilding where the score stands, or takes them off
   * it for good: a player unlisted is done with, as when a component unmounts.
   */
  list(on: boolean): void {
    if (on === this.isListed) return;
    this.isListed = on;
    if (on) this.rebuild();
    else close(this.built);
  }

  /** Plays one frame: syncs the transport at host time `now`, the animation frame's. */
  sync(now: number): void {
    if (now - this.lastHost > STALL_MS) this.apply({ kind: 'rebase' });
    this.apply({ kind: 'sync', at: Math.max(now, this.lastHost) });
    this.emit();
  }

  /** Takes the time since the last sync off the clock, as playing resumes after a pause. */
  rebase(): void {
    this.apply({ kind: 'rebase' });
  }

  /** The transport's rate: the playground's speed, which the debug panel shows and sets too. */
  get rate(): number {
    return this.built.transport.rate;
  }

  /** Sets the rate, ramping it there over `over` ms of host time when given. */
  setRate(rate: number, over?: number): void {
    this.apply({ kind: 'rate', rate, over: over ?? 0 });
    this.emit();
  }

  /**
   * Moves the score to mix time `t`. Ahead, blits plays the mixes there under the rate, or jumps
   * there where the rate (0) never reaches it; back, by `seekBy`. False where blits refuses the
   * time, which leaves the score where it was.
   */
  seek(t: number): boolean {
    const { transport } = this.built;
    if (t === transport.now) return true;
    let ok = true;
    if (t > transport.now) ok = this.apply({ kind: 'seek', to: t });
    else if (!(this.seekBy === 'seek' && this.seekBack(t))) this.replay(this.ops, t);
    this.emit();
    return ok;
  }

  /**
   * Starts the score over at `t` after a loop `length` ms long, as a seek back would, but keeps the
   * picked subject's history: the plots carry on from the lap before rather than starting empty.
   * The rate playing at the end of the lap carries on through the next, and a ramp under way runs on.
   */
  lap(t: number, length: number): void {
    const kept = this.samples;
    const rate = this.rate;
    const ramp = this.ramping();
    this.lapped += length;
    this.seek(t);
    // Even unchanged: a host call after the seek back cuts the rate changes the tape holds ahead.
    this.apply({ kind: 'rate', rate, over: 0 });
    if (ramp !== null) this.apply({ kind: 'rate', rate: ramp.rate, over: ramp.left });
    const first = this.samples[0]?.t ?? Number.POSITIVE_INFINITY;
    this.samples = [...kept.filter((s) => s.t < first), ...this.samples];
    const last = this.samples.at(-1)?.t ?? 0;
    while (this.samples.length > 0 && (this.samples[0] as Sample).t < last - WINDOW)
      this.samples.shift();
    this.emit();
  }

  /**
   * Whether the last frame's clock was moved by something other than the player, such as blits'
   * debug panel holding, stepping or seeking it. The score then shows where the mix is, and does
   * not loop.
   */
  get following(): boolean {
    return this.follows;
  }

  /** The picked subject's pose, per channel, as sure as blits' `assess` says; null with none picked. */
  doubts(): { [K in keyof Mixed]: Doubt } | null {
    const subject = this.picked === null ? undefined : this.subjects[this.picked];
    if (subject === undefined) return null;
    const { mix } = this.built;
    return mix.project(mix.now).assess(subject);
  }

  /**
   * Rebuilds where the score stands, doing again what the host did. Given the composition's
   * levels, a slider move is dropped when its level is gone or the composition's own value for it
   * changed, so an edit takes effect.
   */
  rebuild(levels?: readonly Level[]): void {
    if (levels) this.author(levels);
    this.replay(this.ops, this.built.transport.now);
    this.emit();
  }

  /** Records subject `i` from the frame shown on, or nothing for null. */
  pick(i: number | null): void {
    const next = i !== null && i >= 0 && i < this.subjects.length ? i : null;
    if (next === this.picked) return;
    this.picked = next;
    this.samples = [];
    this.record();
    this.emit();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The picked subject's last `WINDOW` ms; a new object whenever it changed. */
  readonly getSnapshot = (): History => this.history;

  /** Slider values in force, by level name; levels absent here play the composition's value. */
  get moved(): ReadonlyMap<string, number> {
    return this.slid;
  }

  /** Reads voice `id`'s solo frame into `out`; a solo that throws goes on the errors under `id`. */
  solo(id: string, out: Columns): void {
    const solo = this.built.solos.get(id);
    const error = solo && tryPull(solo, this.subjects, out);
    if (error) this.report(id, error);
  }

  /** Voice or group `id`'s handle in the full mix. */
  handleOf(id: string): Handle<Subject> | undefined {
    return this.built.handles.get(id) ?? this.built.groupHandles.get(id);
  }

  /**
   * Acts on voice or group `id` as it runs, in the full mix and in every solo mix, where a voice
   * plays silent beside the soloed one but still keeps time for whatever is anchored to it. `heard`
   * is true for the copies that sound: a voice's in the full mix and its own solo, a group's in
   * every mix, since each solo plays every group at its own weight. A weight belongs only on those;
   * a group has no patch. The change lasts until the next rebuild: an edit, or a seek back by
   * replay. A seek back by `transport.seek` keeps it, as the transport's tape plays it again.
   */
  live(
    id: string,
    act: (
      handle: Handle<Subject>,
      patch: Patch<Subject, Mixed, unknown> | undefined,
      heard: boolean,
    ) => void,
  ): void {
    const handle = this.handleOf(id);
    if (!handle) return;
    const group = this.built.groupHandles.has(id);
    act(handle, this.built.patches.get(id), true);
    for (const [solo, cued] of this.built.soloVoices) {
      const h = cued.handles.get(id) ?? cued.groupHandles.get(id);
      if (h) act(h, cued.patches.get(id), group || solo === id);
    }
    this.isLive = true;
  }

  /** Acts on the full mix and every solo mix as they run; lasts as long as `live`'s changes. */
  liveMix(act: (mix: Mix<Subject, Mixed>) => void): void {
    act(this.built.mix);
    for (const m of this.built.solos.values()) act(m);
    this.isLive = true;
  }

  /** Host time at the last sync. */
  get host(): number {
    return this.lastHost;
  }

  /** Whether a live change is in force, which the next rebuild drops. */
  get livened(): boolean {
    return this.isLive;
  }

  /**
   * Moves the stage's pointer, in dots, and every `around` circle with it, then reads the frame shown
   * again, so a paused stage follows it too.
   */
  point(x: number, y: number): void {
    this.at = { x, y };
    this.built.pointer.move(x, y);
    if (this.built.pointer.circles.length === 0) return;
    for (const m of this.mixes()) m.touch();
    this.pull();
    this.record();
    this.emit();
  }

  setLevel(name: string, value: number): void {
    this.slid.set(name, value);
    this.built.levels.get(name)?.set(value);
  }

  private author(levels: readonly Level[]): void {
    const next = new Map(levels.map((l) => [l.name, l.value]));
    for (const name of this.slid.keys()) {
      const was = this.authored?.get(name);
      if (!next.has(name) || (this.authored !== null && was !== next.get(name)))
        this.slid.delete(name);
    }
    this.authored = next;
  }

  /** The transport's clock and frame number, which a seek back by `transport.seek` restores. */
  get clock(): { now: number; seq: number } {
    const { transport } = this.built;
    return { now: transport.now, seq: transport.seq };
  }

  /**
   * Does `op` to the transport and records it, then reads the frame. False, recording nothing,
   * where blits refuses a seek's time.
   */
  private apply(op: Act): boolean {
    const { transport } = this.built;
    if (op.kind === 'sync') {
      const before = transport.now;
      // A sync after a rebase carries the clock over the gap rather than moving it.
      const expect =
        this.lastNow === null ? Number.NaN : this.rebased ? before : transport.time(op.at);
      this.rebased = false;
      // The booker reads the host's clock during the sync.
      this.lastHost = op.at;
      transport.sync(op.at);
      this.follows = movedElsewhere(this.lastNow, before, expect, transport.now);
      this.lastNow = transport.now;
      this.popHeld();
      if (this.follows) op = { kind: 'land', at: op.at, to: transport.now };
    } else if (op.kind === 'land') {
      transport.rebase();
      this.rebased = false;
      this.lastHost = op.at;
      transport.sync(op.at);
      if (transport.now !== op.to) transport.seek(op.to);
      this.follows = true;
      this.lastNow = transport.now;
      this.popHeld();
    } else if (op.kind === 'rate') transport.ramp(op.rate, op.over);
    else if (op.kind === 'rebase') {
      transport.rebase();
      this.rebased = true;
    } else {
      try {
        transport.seek(op.to);
      } catch (err) {
        if (err instanceof RangeError) return false;
        throw err;
      }
      this.lastNow = transport.now;
    }
    this.ops.push({ ...op, now: transport.now });
    this.shown();
    return true;
  }

  /** A frame held at the last one's time replaces it, so a long hold keeps one op. */
  private popHeld(): void {
    const last = this.ops.at(-1);
    if ((last?.kind === 'sync' || last?.kind === 'land') && last.now === this.built.transport.now)
      this.ops.pop();
  }

  /** Reads the frame the transport stands at into the columns, the events and the plots. */
  private shown(): void {
    const now = this.built.transport.now;
    const t = Math.max(0, now);
    if (t < this.t) {
      this.events.cut(now);
      this.samples = this.samples.filter((s) => s.t <= this.lapped + t);
    }
    this.pull();
    this.events.drain(this.built);
    this.t = t;
    this.record();
  }

  /**
   * Reads the frame into the columns. A mix that throws on a value it cannot pull leaves the last
   * frame standing and goes on the errors, under the voice whose solo throws too, so one bad
   * composition never stops the player.
   */
  private pull(): void {
    const { mix, solos } = this.built;
    let blamed = false;
    for (const [id, solo] of solos) {
      const error = tryPull(solo, this.subjects, this.scratch);
      if (error === null) continue;
      this.report(id, error);
      blamed = true;
    }
    const error = tryPull(mix, this.subjects, this.columns);
    if (error !== null && !blamed) this.report(null, error);
  }

  private report(voice: string | null, error: string): void {
    const { errors } = this.built;
    if (!errors.some((e) => e.voice === voice && e.error === error))
      errors.push({ voice, field: 'patch', error, line: null });
  }

  /** Moves back to `t` with blits' `seek`; false where history cannot reach it. */
  private seekBack(t: number): boolean {
    try {
      this.built.transport.seek(t);
    } catch {
      return false;
    }
    this.cutOps(t);
    this.ops.push({ kind: 'seek', to: t, now: this.built.transport.now });
    this.lastNow = this.built.transport.now;
    this.shown();
    return true;
  }

  /**
   * The rate the last rate change ramps to and the host ms it has left, counted as the transport
   * counts them, without the gaps a rebase took out; null once it has arrived.
   */
  private ramping(): { rate: number; left: number } | null {
    let ramp: { rate: number; left: number } | null = null;
    let host = Number.NaN;
    for (const op of this.ops) {
      if (op.kind === 'rate') ramp = { rate: op.rate, left: op.over };
      else if (op.kind === 'rebase') host = Number.NaN;
      else if (op.kind === 'land') host = op.at;
      else if (op.kind === 'sync') {
        if (ramp !== null && !Number.isNaN(host)) ramp.left -= op.at - host;
        host = op.at;
      }
    }
    return ramp !== null && ramp.left > 0 ? ramp : null;
  }

  /** Drops the ops from the first that left the clock past `t`: what a seek back to `t` undoes. */
  private cutOps(t: number): void {
    const i = this.ops.findIndex((o) => o.now > t);
    if (i >= 0) this.ops.length = i;
  }

  /**
   * Builds afresh and does `ops` again while they leave the clock at or before `t`, then seeks the
   * rest of the way: what playback showed, short of live changes. `host` is the host time playback
   * last synced at, which the replay leaves the clock standing at, so the next frame plays on.
   */
  private replay(ops: readonly Op[], t: number, host = this.lastHost): void {
    const kept = ops.slice();
    const end = kept.findIndex((o) => o.now > t);
    if (end >= 0) kept.length = end;
    this.built = this.fresh();
    for (const { now: _, ...op } of kept) this.apply(op);
    if (this.ops.length === 0) this.apply({ kind: 'sync', at: 0 });
    if (this.built.transport.now < t) this.apply({ kind: 'seek', to: t });
    // The cut ops left the clock at the host time it first passed `t`; play on from now instead.
    if (end >= 0) this.apply({ kind: 'rebase' });
    if (host > this.lastHost) {
      if (end < 0) this.apply({ kind: 'rebase' });
      this.apply({ kind: 'sync', at: host });
    }
  }

  private fresh(): Built {
    // Unset only while the constructor makes the first.
    if (this.built as Built | undefined) close(this.built);
    const built = this.build(this.isListed);
    for (const [name, value] of this.slid) built.levels.get(name)?.set(value);
    if (this.at !== null) built.pointer.move(this.at.x, this.at.y);
    this.ops = [];
    this.lastHost = 0;
    this.lastNow = null;
    this.follows = false;
    this.rebased = false;
    this.isLive = false;
    this.samples = [];
    this.t = 0;
    this.events.attach(built, () => this.lastHost);
    return built;
  }

  private mixes(): Mix<Subject, Mixed>[] {
    return [this.built.mix, ...this.built.solos.values()];
  }

  private record(): void {
    const subject = this.picked === null ? undefined : this.subjects[this.picked];
    if (subject === undefined) return;
    const { mix, solos, handles, groupHandles } = this.built;
    const soloPoses = new Map<string, Mixed>();
    const weights = new Map<string, number>();
    for (const [id, solo] of solos) soloPoses.set(id, copied(solo.probe(subject)));
    for (const [id, handle] of handles) weights.set(id, handle.weightOf(subject));
    for (const [id, handle] of groupHandles) weights.set(id, handle.weightOf(subject));
    const h = this.samples;
    const t = this.lapped + this.t;
    if (h.length > 0 && (h[h.length - 1] as Sample).t === t) h.pop();
    h.push({ t, full: copied(mix.probe(subject)), solos: soloPoses, weights });
    while (h.length > 0 && (h[0] as Sample).t < t - WINDOW) h.shift();
  }

  private emit(): void {
    this.history = { picked: this.picked, samples: this.samples.slice() };
    for (const listener of this.listeners) listener();
  }
}
