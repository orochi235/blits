import { type Built, FRAME } from './compile';
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
  private readonly moved = new Map<string, number>();

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
  ) {
    this.columns = Player.columnsFor(subjects.length);
    this.scratch = Player.columnsFor(subjects.length);
    this.built = this.fresh();
    this.step(0);
  }

  seek(t: number): void {
    const target = frameOf(t);
    if (target < this.frame) this.built = this.fresh();
    for (let f = this.frame + 1; f <= target; f++) this.step(f);
  }

  rebuild(): void {
    const target = Math.max(0, this.frame);
    this.built = this.fresh();
    for (let f = 0; f <= target; f++) this.step(f);
  }

  solo(id: string, out: Columns): void {
    this.built.solos.get(id)?.pull(this.subjects, out);
  }

  setLevel(name: string, value: number): void {
    this.moved.set(name, value);
    this.built.levels.get(name)?.set(value);
  }

  private fresh(): Built {
    const built = this.build();
    for (const [name, value] of this.moved) built.levels.get(name)?.set(value);
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
