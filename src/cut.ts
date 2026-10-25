/** Where history is cut for a seek or read: what frame `seq` made, and before it, is kept. */
export interface Cut {
  seq: number;
  /** For a read of what a frame showed: of that frame's own changes, only those made before it was read. */
  strict: boolean;
}

/** Whether a change made in frame `seq` falls inside `cut`; `early` for one made before the frame was read. */
export function within(cut: Cut, seq: number, early = false): boolean {
  return seq < cut.seq || (seq === cut.seq && (!cut.strict || early));
}
