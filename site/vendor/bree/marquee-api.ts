import type { Mix } from '@msb235/blits';
import type { Board, Led, Pose, Subject } from './board.js';
import type { Border } from './border.js';
import type { Defect } from './defects.js';
import type { Lamps, SignColumns } from './draw.js';
import type { EffectSpec } from './effects.js';
import type { Grid, GridName } from './grid.js';
import type { LayerOption } from './layers.js';
import type { Fade, Ghost } from './optics.js';
import type { ParamValue } from './params.js';
import type { Pass } from './pass.js';
import type { Plane } from './planes.js';
import type { Scene } from './program.js';
import type { Backend } from './render/backend.js';
import type { Gpu } from './render/gpu.js';
import type { Housing } from './render/housing.js';
import type { Ticker } from './ticker.js';

/** What one frame cost, smoothed over about twenty frames. */
export interface FrameCost {
  /**
   * `sync` plus the `pull` of every channel the CPU folds, ms. On WebGPU it also counts dispatching
   * the GPU's fold, though not the GPU's work.
   */
  readonly mixMs: number;
  /** The canvas work, ms; 0 with `draw: false`. */
  readonly drawMs: number;
  /** What drew the frame; `2d` with `draw: false`. */
  readonly backend: Backend;
  /** This frame's own `mixMs` and `drawMs`, unsmoothed, for a benchmark keeping every frame. */
  readonly raw: { readonly mixMs: number; readonly drawMs: number };
}

export interface MarqueeOptions {
  /** Dots across and down. Default 80 × 7, one line of text. */
  readonly cols?: number;
  readonly rows?: number;
  /**
   * How the dots are set out: `square`, `hex`, or a grid of your own placing each column and row.
   * Only the drawing reads it; text and effects still count dots by column and row. Default square.
   */
  readonly grid?: GridName | Grid;
  /**
   * The messages it plays, in a loop. A function is read again at the start of every pass, so a
   * program can follow inputs that change. Default: nothing, until `setProgram`.
   */
  readonly program?: readonly Scene[] | (() => readonly Scene[]);
  /** Effects scenes can name, ahead of the built-ins. */
  readonly effects?: Readonly<Record<string, EffectSpec>>;
  /**
   * Layers by name: a built-in's name with on, off or a weight, or a full spec under any name.
   * Default: none.
   */
  readonly layers?: Partial<Record<string, LayerOption>>;
  /**
   * The border of bulbs round the dots and how they light, or false for none, which also takes
   * away the margin they stand in. Fixed once made, but `setBorder` changes how they light.
   * Default unlit bulbs.
   */
  readonly border?: false | Border;
  /**
   * Another sign whose planes this one takes over, each dot from the dot at the same place on it:
   * `color` makes a preview wear what the main sign is wearing while keeping its own shape.
   * `source` is read every frame, so it can follow a sign that is replaced, and a destroyed one is
   * not followed. Between two WebGPU signs on one device it happens on the GPU; from a WebGPU sign
   * on another device, or to a sign drawn otherwise, it is read back a frame or so late. Default
   * none.
   */
  readonly follow?: Follow;
  /**
   * What shows round the lights: `dark` a dark housing with a socket for every dot, `clear` the
   * sockets over the page, `none` only lit light, so an unlit dot is absent. Default `dark`.
   */
  readonly housing?: Housing;
  /** The color of a lit dot nothing has tinted. Default amber. */
  readonly color?: number;
  /** The mix's rate. Default 1. */
  readonly rate?: number;
  /** Broken lights, which show their fault whatever the program asks; `scatter` makes some. Default none. */
  readonly defects?: readonly Defect[];
  /** How fast its lights light and go dark, ms. Default 12 up, 110 down, like a filament. */
  readonly fade?: Fade;
  /** How much an unlit dot shows of its lit row and column, as a multiplexed sign does. Default none. */
  readonly ghost?: Ghost;
  /** How its lights are sized, spaced, lit and bloom. Default: fitted to the parent, as built. */
  readonly lamps?: Lamps;
  /** False runs the mix without drawing, for timing it alone, on the CPU. Default true. */
  readonly draw?: boolean;
  /**
   * A WebGPU device from `gpu()`, which one page shares among its signs. Given one, the sign draws
   * with WebGPU and folds what it can of its mix on the GPU. Default none.
   */
  readonly gpu?: Gpu | null;
  /**
   * Forces what it draws with: `webgpu` needs `gpu`, and `webgl` falls back to `2d` where the page
   * has no WebGL context to give. Default WebGPU with `gpu`, else WebGL where the browser has it,
   * else 2D.
   */
  readonly backend?: Backend;
  /**
   * The clock its frames run on; signs sharing one draw from one animation frame callback, and a
   * throttled one draws them less often. Default a ticker of its own, every display frame.
   */
  readonly ticker?: Ticker;
  /** Called after every frame with what it cost. */
  readonly onFrame?: (cost: FrameCost) => void;
  /**
   * What debuggers call its mix. Default `marquee #<canvas id> <cols>×<rows>`, or without an id
   * `marquee <cols>×<rows>`.
   */
  readonly name?: string;
}

/** Which sign a marquee follows, and in which planes. */
export interface Follow {
  readonly source: () => Marquee | null;
  readonly planes: readonly Plane[];
}

export interface Marquee {
  readonly board: Board;
  /** What it draws with: what was asked for, or what it fell back to. `2d` with `draw: false`. */
  readonly backend: Backend;
  /**
   * Its dots and border bulbs as the last frame drew them. On 2D and WebGL that is every channel.
   * On WebGPU the channels folded on the GPU are read back only while something reads `columns`:
   * reading it starts that, and it stops 60 frames after the last read. They land a frame behind
   * what was drawn, and the first read finds what was last laid there, zeros on a new sign.
   */
  readonly columns: SignColumns;
  /**
   * Draws the last frame again without running the mix, taking what it follows afresh: for a
   * still that follows a moving sign.
   */
  repaint(): void;
  /**
   * Marks dots to draw swapped, lit for dark and dark for lit, over whatever the mix gives them:
   * a text selection or a caret on a sign that is being typed into. Null marks none.
   */
  setHighlight(marked: ((dot: Led) => boolean) | null): void;
  /** The mix lighting it, for cueing voices of your own on its dots and border cells. */
  readonly mix: Mix<Subject, Pose>;
  /** Replaces the program from the next pass; throws on a scene naming no effect or face. */
  setProgram(program: readonly Scene[] | (() => readonly Scene[])): void;
  /** Replaces the effects scenes can name, from the next pass; throws if a scene names none of them. */
  setEffects(effects: Readonly<Record<string, EffectSpec>>): void;
  /** Starts the program over at `fromScene`, fading the pass playing now at once. */
  restart(fromScene?: number): void;
  /** Where the pass playing now stands, on the mix clock, so rate changes count; null while none plays. */
  pass(): Pass | null;
  /**
   * Moves the pass playing now to `ms` from its start, clamped to its length. With `hold`, it stays
   * at that moment until a seek without it, or the next restart.
   */
  seek(ms: number, opts?: { hold?: boolean }): void;
  /**
   * Moves a pass waiting for input on: to its next rest, or from the last one to where it plays on.
   * Does nothing while it is not waiting; a host calls it on a key press or any input it likes.
   */
  step(): void;
  /** Turns a layer on or off, or sets the weight it plays at; `params` re-cue it with them. */
  setLayer(name: string, on: boolean | number, params?: Readonly<Record<string, ParamValue>>): void;
  /** The color of a lit dot nothing has tinted. */
  setColor(hex: number): void;
  /** Ramps the mix's rate to `rate` over `ms`. */
  ramp(rate: number, ms?: number): void;
  /** Replaces the broken lights. */
  setDefects(defects: readonly Defect[]): void;
  /** Sets how fast its lights light and go dark. */
  setFade(fade: Fade): void;
  /** Sets how much an unlit dot shows of its lit row and column. */
  setGhost(ghost: Ghost): void;
  /** Sets how its lights are sized, spaced, lit and bloom. */
  setLamps(lamps: Lamps): void;
  /** Sets how the border's bulbs light; a sign made with no border has none to light. */
  setBorder(border: Border): void;
  /**
   * Stops the frame loop, lets go of the canvas, and takes its mix off the debuggers' list. A sign
   * made on the canvas afterward draws once a WebGL context lost here is restored; a canvas once
   * drawn with WebGL or WebGPU can't take a 2D sign.
   */
  destroy(): void;
}
