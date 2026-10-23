import type { Patch } from '@msb235/blits';
import type { Board, Cell, Led, Pose } from '../board';
import type { Bitmap } from '../font';

/** A number an effect is tuned by, with the range a control should offer and its default. */
export interface Param {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit?: string;
}

export type Params = Readonly<Record<string, Param>>;
export type Values<P extends Params> = { readonly [K in keyof P]: number };

/** A text effect ready to cue on the dots: its patch, the per-dot delay it plays with, and how long it lasts. */
export interface Staged {
  readonly patch: Patch<Led, Pose>;
  readonly stagger?: (led: Led) => number;
  readonly ms: number;
}

/** A message coming on, standing and going; a program plays these one after another. */
export interface TextEffect<P extends Params = Params> {
  readonly kind: 'text';
  readonly name: string;
  readonly about: string;
  readonly params: P;
  /** Whether the board has room for it. Default: always. */
  readonly fits?: (b: Board) => boolean;
  stage(b: Board, text: Bitmap, hex: number, p: Values<P>): Staged;
}

/** A loop running over whatever else is on, for as long as it is cued. */
export interface Layer<P extends Params = Params> {
  readonly kind: 'layer';
  readonly name: string;
  readonly about: string;
  readonly params: P;
  /** The subjects it plays on: the sign's dots or the border's cells. */
  readonly on: 'dots' | 'cells';
  /** Its weight when on, against the text's 1. Default 1. */
  readonly weight?: number;
  patch(b: Board, p: Values<P>): Patch<Led, Pose> | Patch<Cell, Pose>;
}

export type Effect = TextEffect | Layer;

/** An effect's defaults with `given` laid over them. */
export function values<P extends Params>(
  effect: { readonly params: P },
  given: Partial<Values<P>> = {},
): Values<P> {
  const out: Record<string, number> = {};
  for (const [key, param] of Object.entries(effect.params)) out[key] = given[key] ?? param.value;
  return out as Values<P>;
}

/** Declares a text effect, keeping its params' keys in the type `stage` sees. */
export const textEffect = <P extends Params>(e: Omit<TextEffect<P>, 'kind'>): TextEffect<P> => ({
  kind: 'text',
  ...e,
});

/** Declares a layer, keeping its params' keys in the type `patch` sees. */
export const layer = <P extends Params>(e: Omit<Layer<P>, 'kind'>): Layer<P> => ({
  kind: 'layer',
  ...e,
});

/** The row of the text a dot shows, or -1 for one between lines or a bulb. */
export const rowOf = (led: Led) => (led.kind === 'dot' ? led.row : -1);
