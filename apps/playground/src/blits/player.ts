import type { Handle, Mix, Patch } from '@msb235/blits';
import { type Built, FRAME } from './compile';
import type { Level } from './composition';
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

export class Player {
  built: Built;
  t = 0;
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
    if (target < this.frame) this.built = this.fresh();
    for (let f = this.frame + 1; f <= target; f++) this.step(f);
    this.emit();
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

  /**
   * Acts on voice `id` as it runs, in the full mix and in every solo mix, where it plays silent
   * beside the soloed voice but still keeps time for whatever is anchored to it. `heard` is true
   * for the copies that sound, the full mix's and its own solo's: a weight belongs only on those.
   * The change lasts until the next rebuild: an edit, or a seek back.
   */
  live(
    id: string,
    act: (handle: Handle<Subject>, patch: Patch<Subject, Mixed, unknown>, heard: boolean) => void,
  ): void {
    const handle = this.built.handles.get(id);
    const patch = this.built.patches.get(id);
    if (!handle || !patch) return;
    act(handle, patch, true);
    for (const [solo, voices] of this.built.soloVoices) {
      const h = voices.handles.get(id);
      const p = voices.patches.get(id);
      if (h && p) act(h, p, solo === id);
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

  private fresh(): Built {
    const built = this.build();
    for (const [name, value] of this.slid) built.levels.get(name)?.set(value);
    this.frame = -1;
    this.isLive = false;
    this.samples = [];
    return built;
  }

  private step(f: number): void {
    const t = f * FRAME;
    const { mix, solos } = this.built;
    mix.sync(t);
    mix.pull(this.subjects, this.columns);
    for (const solo of solos.values()) {
      solo.sync(t);
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
