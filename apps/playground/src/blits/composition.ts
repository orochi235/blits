import type { Easing, Keyframe, Placement } from '@msb235/blits';
import type { ChannelName, Pose } from './kit';

/** Source of a function: `(s) => …` for a subject, a signal such as `slew(level('x'), …)`. */
export interface Expr {
  code: string;
}

export interface Level {
  name: string;
  value: number;
  min: number;
  max: number;
}

export type StageSpec =
  | { kind: 'dots'; cols: number; rows: number }
  | { kind: 'letters'; text: string };

export type PatchSource =
  | { kind: 'keys'; period: number; stops: Keyframe<Pose>[]; ease?: Easing }
  | { kind: 'fn'; period: number; writes: ChannelName[]; at: string; state?: string; step?: string }
  | {
      kind: 'spring' | 'glide' | 'tween';
      channel: ChannelName;
      opts: Record<string, number | number[] | Expr>;
      /** A tween's curve; spring and glide have none. */
      ease?: Easing;
    };

export interface Voice {
  id: string;
  name: string;
  hue: number;
  patch: PatchSource;
  start: number;
  rate: number;
  loop: boolean | number;
  stagger?: Expr;
  target?: Expr;
  hold?: 'before' | 'after' | 'both';
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  locus?: string;
  from?: 'current';
  anchor?: Placement;
}

export interface Composition {
  version: 1;
  title: string;
  stage: StageSpec;
  length: number;
  levels: Level[];
  voices: Voice[];
}

export const isExpr = (v: unknown): v is Expr =>
  typeof v === 'object' && v !== null && typeof (v as Expr).code === 'string';
