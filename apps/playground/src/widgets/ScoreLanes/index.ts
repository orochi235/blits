export interface Clip {
  id: string;
  lane: number;
  label: string;
  hue: number;
  start: number; // ms
  pass: number; // ms one pass lasts; 0 = no passes
  passes: number; // Infinity = open-ended
  fadeIn: number;
  fadeOut: number;
  spread: number; // ms from first to last subject's start; 0 = none
  spreadAt?: number; // ms after start where the first subject starts; default 0
  freezeBefore: boolean;
  freezeAfter: boolean;
  group?: string;
  locked?: boolean; // start is set elsewhere (anchored): body drag disabled
  depth?: number; // headers above it; the label indents per step
  factor?: number; // its rate over its own, shown after the label when not 1
  skipped?: boolean; // jumped to its end: an outline at its natural length
  cut?: { at: number; fade: number }; // ms where a group above ends it, and that group's fade out
  into?: number; // ms of its first pass already behind its start; default 0
  ticks?: readonly number[]; // ms into each pass where a notch sits
  stops?: readonly number[]; // the passes its end snaps to, ascending; default every whole number
}

/** A lane heading the clips and headers below it that sit deeper, up to the next that does not. */
export interface Header {
  id: string;
  lane: number;
  depth: number;
  label: string;
  hue: number;
  start: number; // ms
  end: number; // ms; Infinity = open-ended
  fadeIn?: number;
  fadeOut?: number;
  budget?: number; // ms on the score where its budget ends
  over?: number; // ms past the budget
  fell?: boolean;
  folded?: boolean;
}
/** A named time, drawn down every lane. */
export interface ScoreMark {
  at: number; // ms
  label: string;
}
export type Edge = 'start' | 'end';
export interface Link {
  from: { clip: string; edge: Edge };
  to: { clip: string; edge: Edge };
  /** One of several the `from` edge waits on: every one of them (`all`), or one (`any`). */
  join?: 'all' | 'any';
}
export type Hatch = 'before' | 'after' | 'both' | null;
export type ClipEdit =
  | { clip: string; kind: 'move'; start: number }
  | { clip: string; kind: 'fadeIn' | 'fadeOut'; ms: number }
  | { clip: string; kind: 'passes'; passes: number }
  | { clip: string; kind: 'link'; link: Link }
  | { clip: string; kind: 'hatch'; hatch: Hatch }
  | { clip: string; kind: 'group'; with: string | null }; // null leaves its group
export interface ScoreLanesProps {
  clips: readonly Clip[];
  links: readonly Link[];
  duration: number;
  playhead: number;
  selected: string | null;
  onSelect(id: string | null): void;
  onEdit(edit: ClipEdit): void;
  onScrub(t: number): void;
  headers?: readonly Header[];
  marks?: readonly ScoreMark[];
  onFold?(id: string, folded: boolean): void;
  laneHeight?: number; // default 36
  labelWidth?: number; // default 140
}

export { hatchOf } from './drag';
export { MAX_PASSES } from './geometry';
export { ScoreLanes } from './ScoreLanes';
