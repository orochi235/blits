import type { Doubt, Handle, Mix, Patch } from '@msb235/blits';
import type { Built } from './compile';
import type { Level } from './composition';
import { FRAME } from './frame';
import type { Mixed } from './kit';
import type { Subject } from './stage';

export interface Columns {
  offset: Float64Array;
  turn: Float64Array;
  scale: Float64Array;
  color: Float64Array;
  opacity: Float64Array;
  glow: Float64Array;
}

const frameOf = (t: number) => Math.max(0, Math.floor(t / FRAME + 1e-9));

/** How much history the picked subject keeps, ms of score time. */
export const WINDOW = 3000;

/** The picked subject at one frame: the mix's pose, each voice's solo pose, each voice's `weightOf`. */
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

// Probes write into a pose the mix reuses, so each is copied before the next.
const copied = (p: Mixed): Mixed => ({
  ...p,
  offset: [...p.offset],
  ...(p.color ? { color: [...p.color] } : {}),
});

/**
 * How the player moves back: `replay` rebuilds and plays from 0, so a scrub shows what playback
 * showed; `seek` calls blits' `mix.seek`, which restores from history and is as sure as it says.
 */
export type SeekBy = 'replay' | 'seek';

export class Player {
  built: Built;
  t = 0;
  seekBy: SeekBy = 'replay';
  // Frames of host clock synced since the mixes were built; it only goes forward, even across a seek.
  private hostFrame = -1;
  readonly columns: Columns;
  private frame = -1;
  private readonly scratch: Columns;
  // Slider moves outlive a rebuild: a replay plays them at their current value.
  private readonly slid = new Map<string, number>();
  private authored: Map<string, number> | null = null;
  private isLive = false;
  private picked: number | null = null;
  private samples: Sample[] = [];
  private history: History = { picked: null, samples: [] };
  private readonly listeners = new Set<() => void>();

  static columnsFor(n: number): Columns {
    return {
      offset: new Float64Array(n * 2),
      turn: new Float64Array(n),
      scale: new Float64Array(n),
      color: new Float64Array(n * 4),
      opacity: new Float64Array(n),
      glow: new Float64Array(n),
    };
  }

  constructor(
    private readonly build: () => Built,
    readonly subjects: readonly Subject[],
    /** The composition's levels; `from`, a player this one replaces, hands over its sliders and playhead. */
    init?: { levels: readonly Level[]; from?: Player | null },
  ) {
    this.columns = Player.columnsFor(subjects.length);
    this.scratch = Player.columnsFor(subjects.length);
    const from = init?.from;
    if (from) {
      for (const [name, v] of from.slid) this.slid.set(name, v);
      this.authored = from.authored && new Map(from.authored);
    }
    if (init) this.author(init.levels);
    this.built = this.fresh();
    this.step(0);
    if (from) this.seek(from.t);
  }

  seek(t: number): void {
    const target = frameOf(t);
    if (target === this.frame) return;
    if (target < this.frame && !(this.seekBy === 'seek' && this.seekBack(target)))
      this.built = this.fresh();
    for (let f = this.frame + 1; f <= target; f++) this.step(f);
    this.emit();
  }

  /** The picked subject's pose, per channel, as sure as blits' `assess` says; null with none picked. */
  doubts(): { [K in keyof Mixed]: Doubt } | null {
    const subject = this.picked === null ? undefined : this.subjects[this.picked];
    if (subject === undefined || this.frame < 0) return null;
    const { mix } = this.built;
    return mix.project(mix.now).assess(subject);
  }

  /**
   * Rebuilds at the same frame. Given the composition's levels, a slider move is dropped when its
   * level is gone or the composition's own value for it changed, so an edit takes effect.
   */
  rebuild(levels?: readonly Level[]): void {
    if (levels) this.author(levels);
    const target = Math.max(0, this.frame);
    this.built = this.fresh();
    for (let f = 0; f <= target; f++) this.step(f);
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

  solo(id: string, out: Columns): void {
    this.built.solos.get(id)?.pull(this.subjects, out);
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
   * replay. A seek back by `mix.seek` keeps it, as the mix's tape plays it again.
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

  /** Whether a live change is in force, which the next rebuild drops. */
  get livened(): boolean {
    return this.isLive;
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

  /** Moves every mix back to `target` with `mix.seek`; false where history cannot reach it. */
  private seekBack(target: number): boolean {
    const { mix, solos } = this.built;
    const time = target * FRAME;
    const host = this.hostFrame * FRAME;
    try {
      for (const m of [mix, ...solos.values()]) {
        m.seek(time);
        m.sync(host);
      }
    } catch {
      return false;
    }
    mix.pull(this.subjects, this.columns);
    this.frame = target;
    this.t = time;
    this.samples = this.samples.filter((s) => s.t <= time);
    this.record();
    return true;
  }

  private fresh(): Built {
    const built = this.build();
    for (const [name, value] of this.slid) built.levels.get(name)?.set(value);
    this.frame = -1;
    this.hostFrame = -1;
    this.isLive = false;
    this.samples = [];
    return built;
  }

  private step(f: number): void {
    const t = f * FRAME;
    this.hostFrame++;
    const host = this.hostFrame * FRAME;
    const { mix, solos } = this.built;
    mix.sync(host);
    mix.pull(this.subjects, this.columns);
    for (const solo of solos.values()) {
      solo.sync(host);
      solo.pull(this.subjects, this.scratch);
    }
    this.frame = f;
    this.t = t;
    this.record();
  }

  private record(): void {
    const subject = this.picked === null ? undefined : this.subjects[this.picked];
    if (subject === undefined || this.frame < 0) return;
    const { mix, solos, handles } = this.built;
    const soloPoses = new Map<string, Mixed>();
    const weights = new Map<string, number>();
    for (const [id, solo] of solos) soloPoses.set(id, copied(solo.probe(subject)));
    for (const [id, handle] of handles) weights.set(id, handle.weightOf(subject));
    const h = this.samples;
    if (h.length > 0 && (h[h.length - 1] as Sample).t === this.t) h.pop();
    h.push({ t: this.t, full: copied(mix.probe(subject)), solos: soloPoses, weights });
    while (h.length > 0 && (h[0] as Sample).t < this.t - WINDOW) h.shift();
  }

  private emit(): void {
    this.history = { picked: this.picked, samples: this.samples.slice() };
    for (const listener of this.listeners) listener();
  }
}
