/**
 * What crosses between the page, where the mixes are, and the panel, which shows them: plain data
 * that survives `structuredClone`, so the two halves can sit in one page or either side of a
 * message channel. Mixes, subjects and voices cross as numbers.
 */

export interface MixInfo {
  id: number;
  name: string;
  release: string;
  channels: string[];
  /** What history the mix keeps; null for none. */
  history: { ms: number; tape: boolean; added: boolean } | null;
}

export interface SubjectInfo {
  id: number;
  label: string;
}

export interface VoiceInfo {
  id: number;
  name: string | null;
  tags: string[];
  state: string;
  /** Its weight on the picked subject, NaN with none picked. */
  weight: number;
}

/**
 * The picked subject in one frame: each numeric part of its pose by a flat key (`x`,
 * `position[1]`, `color.l`), and each voice's weight on it by voice id.
 */
export interface Sample {
  now: number;
  values: Record<string, number>;
  weights: Record<number, number>;
  /** The host did not read the subject this frame, so the panel read it. */
  read: boolean;
}

/**
 * A mark the plan knows, as `mix.marks` lists it: a voice's start, in, coast, out or end, one it
 * placed inside itself, or one the host announced.
 */
export interface MarkInfo {
  /** On the mix clock, the plots' axis. */
  at: number;
  /** Which of a voice's marks; null for an announced one. */
  mark: string | null;
  /** The voice's id; null for an announced mark. */
  voice: number | null;
  name: string | null;
  tags: string[];
}

export interface HoldInfo {
  /** `elsewhere`: something other than this panel holds the clock. */
  state: 'free' | 'held' | 'elsewhere';
  rate: number;
  now: number;
  /** The earliest time a seek reaches; `now` where the mix cannot go back. */
  reach: number;
}

export type Event =
  | { kind: 'mixes'; mixes: MixInfo[] }
  | { kind: 'picked'; mix: number | null; subject: number | null }
  | { kind: 'subjects'; subjects: SubjectInfo[] }
  | { kind: 'voices'; voices: VoiceInfo[] }
  /** `reset`: forget what was kept, as a new pick or a new mix does, before these. */
  | { kind: 'samples'; samples: Sample[]; reset: boolean }
  | { kind: 'hold'; hold: HoldInfo }
  /** Every mark from as far back as the plots reach to `AHEAD_CAP_MS` ahead, earliest first. */
  | { kind: 'marks'; marks: MarkInfo[] }
  | { kind: 'arming'; on: boolean };

export type Command =
  | { kind: 'mix'; id: number | null }
  | { kind: 'subject'; id: number | null }
  | { kind: 'hold'; on: boolean }
  | { kind: 'rate'; rate: number }
  | { kind: 'step'; ms: number }
  | { kind: 'seek'; to: number }
  | { kind: 'arm'; on: boolean }
  | { kind: 'outline'; subject: number | null };

/** One side of the seam: events come up from the page, commands go down to it. */
export interface Source {
  subscribe(fn: (event: Event) => void): () => void;
  send(command: Command): void;
}
