/** A horizontal line that every strip tapping it feeds, ending in the rule that folds it. */
export interface DeskBus {
  id: string;
  label: string;
  rule: string;
  /** The folded value now; unset when the desk is not live. */
  value?: string;
  /** A CSS color drawn beside the value, for a bus that folds a color. */
  swatch?: string;
}
/** A vertical strip tapping the buses it writes. */
export interface DeskStrip {
  id: string;
  label: string;
  /** Shown on hover, after the label. */
  detail?: string;
  hue?: number;
  faulted?: boolean;
  /** The ids of the buses it taps. */
  taps: string[];
  /** Its weight now, which lights its taps; unset when the desk is not live. */
  level?: number;
}
/** A bracket over the strips it holds, which sit next to each other in desk order. */
export interface DeskGroup {
  id: string;
  label: string;
  hue?: number;
  faulted?: boolean;
  /** The first and last strip it holds, by id. */
  first: string;
  last: string;
  /** 0 for a group nothing holds, one more per group around it. */
  depth: number;
  level?: number;
}
export interface Desk {
  buses: DeskBus[];
  strips: DeskStrip[];
  groups?: DeskGroup[];
}
