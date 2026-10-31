import { SEQ_MS, SEQUENCES, type Timeline } from './build';

/**
 * Which clips the reel has run back over since they last started. A sequence is run back over when
 * mix time moves forward with the reel turned back and the reel's clock falls across it; a jump of
 * the reel is not. A clip starts each time its voice goes live.
 */
export function backTracker(t: Timeline) {
  const n = t.clips.length;
  const startedAt = new Float64Array(n).fill(-1);
  const wasLive = new Uint8Array(n);
  const backOver = new Float64Array(SEQUENCES).fill(Number.NEGATIVE_INFINITY);
  let prevAt = 0;
  let prevNow = 0;

  /** Called after frame `f`'s sync, with the reel's clock `at`; `jumped` when the reel was sought. */
  function note(f: number, at: number, jumped: boolean): void {
    for (let c = 0; c < n; c++) {
      const live = (t.voices[c] as (typeof t.voices)[number]).state === 'live' ? 1 : 0;
      if (live && !wasLive[c]) startedAt[c] = f;
      wasLive[c] = live;
    }
    if (!jumped && t.reel.rate < 0 && t.m.now > prevNow && at < prevAt) {
      for (let q = 0; q < SEQUENCES; q++) {
        if (at < (q + 1) * SEQ_MS && prevAt > q * SEQ_MS) backOver[q] = f;
      }
    }
    prevAt = at;
    prevNow = t.m.now;
  }

  /** One flag per clip: run back over since it last started. */
  function tainted(): Uint8Array {
    const out = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      out[c] = (backOver[t.seqOf[c] as number] as number) >= (startedAt[c] as number) ? 1 : 0;
    }
    return out;
  }

  return { note, tainted };
}
