/** What a check found. `undecided` is behavior blits has not settled; `gap` is something the scenario had to do itself. */
export interface Finding {
  kind: 'fail' | 'undecided' | 'gap';
  /** Frame the finding was seen at, when it has one. */
  at?: number;
  what: string;
}

export interface Scenario {
  readonly name: string;
  /** Simulated ms per frame. */
  readonly frameMs: number;
  /** Numbers `read` writes. */
  readonly width: number;
  /** Feeds frame `f`'s workload, then syncs the mix to `f * frameMs`. Frames arrive in order from 0. */
  step(f: number): void;
  /** Reads every subject into `out`, `width` numbers. */
  read(out: Float64Array): void;
  /** Counts worth recording each window: voices, subjects, anything the demo cares about. */
  stats(): Record<string, number>;
  /** Runs after the frames have played; empty when all is right. */
  check(): Finding[];
  /** Draws the current state, scaled to the canvas. Only the page calls it. */
  draw?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  close(): void;
}

export interface MakeOptions {
  seed: number;
  /** Scales the workload; each demo says what 1 unit means. */
  size: number;
  /** `false` runs the general path, as `BLITS_LANES=off` does. */
  lanes?: boolean;
}

export type Make = (opts: MakeOptions) => Scenario;

export interface Entry {
  make: Make;
  /** Size and frames the page and a plain run use. */
  size: number;
  frames: number;
  /** One line for the picker and the README. */
  blurb: string;
}
