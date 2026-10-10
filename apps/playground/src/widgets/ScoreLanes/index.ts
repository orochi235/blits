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
export type Edge = 'start' | 'end';
export interface Link {
  from: { clip: string; edge: Edge };
  to: { clip: string; edge: Edge };
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
  onFold?(id: string, folded: boolean): void;
  laneHeight?: number; // default 36
  labelWidth?: number; // default 140
}

export { hatchOf } from './drag';
export { ScoreLanes } from './ScoreLanes';
