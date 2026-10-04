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
  holdBefore: boolean;
  holdAfter: boolean;
  group?: string;
  locked?: boolean; // start is set elsewhere (anchored): body drag disabled
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
  laneHeight?: number; // default 36
  labelWidth?: number; // default 140
}

export { ScoreLanes } from './ScoreLanes';
