import type { Easing, Keyframe, Placement, WaveShape } from '@msb235/blits';
import type { ChannelName, Pose, Rules, SwingName } from './kit';

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
  | {
      kind: 'keys';
      period: number;
      stops: Keyframe<Pose>[];
      ease?: Easing;
      /** A curve for one channel, where it differs from `ease`. */
      easeBy?: Partial<Record<ChannelName, Easing>>;
      /** Milliseconds a channel waits before it starts moving. */
      delayBy?: Partial<Record<ChannelName, number>>;
    }
  | { kind: 'fn'; period: number; writes: ChannelName[]; at: string; state?: string; step?: string }
  | {
      kind: 'wave';
      period: number;
      shape: WaveShape;
      cycles: number;
      phase: number;
      depth: Partial<Record<SwingName, number>>;
    }
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
  freeze?: 'before' | 'after' | 'both';
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  locus?: string;
  from?: 'current';
  anchor?: Placement;
}

/** blits' `MixOptions` a composition may set; each unset one keeps the default `compile` gives. */
export interface MixSettings {
  /** A fixed interval for every `step`, ms, or `'off'` to step by the frame's gap. Default a frame. */
  stepMs?: number | 'off';
  maxDt?: number;
  reduce?: boolean;
  lanes?: boolean;
}

export interface Composition {
  version: 1;
  title: string;
  stage: StageSpec;
  length: number;
  levels: Level[];
  voices: Voice[];
  mix?: MixSettings;
  /** Each channel's fold rule, where it differs from `DEFAULT_RULES`. */
  rules?: Partial<Rules>;
}

/** A patch that moves one channel toward a target rather than playing a fixed pass. */
export type Motion = Extract<PatchSource, { kind: 'spring' | 'glide' | 'tween' }>;

export const isMotion = (p: PatchSource): p is Motion =>
  p.kind === 'spring' || p.kind === 'glide' || p.kind === 'tween';

/** How long one pass of a patch runs, for the kinds that have a fixed pass. */
export const periodOf = (p: PatchSource): number | undefined =>
  p.kind === 'keys' || p.kind === 'fn' || p.kind === 'wave' ? p.period : undefined;

export const isExpr = (v: unknown): v is Expr =>
  typeof v === 'object' && v !== null && typeof (v as Expr).code === 'string';

/** The most a composition may hold; `load` refuses more, and no editor offers more. */
export const MAX_COLS = 64;
export const MAX_ROWS = 64;
export const MAX_TEXT = 200;
export const MAX_LENGTH = 120_000;
export const MAX_VOICES = 64;
export const MAX_LEVELS = 16;
