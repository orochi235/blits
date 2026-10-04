import { type Built, FRAME } from './compile';
import type { Level } from './composition';
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

export class Player {
  built: Built;
  t = 0;
  readonly columns: Columns;
  private frame = -1;
  private readonly scratch: Columns;
  // Slider moves outlive a rebuild: a replay plays them at their current value.
  private readonly slid = new Map<string, number>();
  private authored: Map<string, number> | null = null;

  static columnsFor(n: number): Columns {
    return {
      offset: new Float64Array(n * 2),
      turn: new Float64Array(n),
      scale: new Float64Array(n),
      color: new Float64Array(n),
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
    if (target < this.frame) this.built = this.fresh();
    for (let f = this.frame + 1; f <= target; f++) this.step(f);
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
  }

  /** Slider values in force, by level name; levels absent here play the composition's value. */
  get moved(): ReadonlyMap<string, number> {
    return this.slid;
  }

  solo(id: string, out: Columns): void {
    this.built.solos.get(id)?.pull(this.subjects, out);
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
  }
}
