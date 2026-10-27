import type { MarkInfo, VoiceInfo } from '../protocol.js';
import { AHEAD_CAP_MS, AHEAD_MS, WINDOW_MS } from '../store.js';
import { voiceHue } from './hue.js';

/** One voice's row in the plan. */
export interface Lane {
  voice: number;
  label: string;
  hue: number;
  marks: MarkInfo[];
  /** Its start, or -Infinity where that lies before what was listed. */
  from: number;
  /** Its end, or Infinity where none is known: it loops for good, or ends past the cap. */
  to: number;
}

const playing = new Set(['live', 'frozen', 'fading']);

/**
 * The plan by voice, earliest start first: a lane for each voice with a mark listed and each
 * playing on with none, and the marks the host announced.
 */
export function lanesOf(
  marks: readonly MarkInfo[],
  voices: readonly VoiceInfo[],
): { lanes: Lane[]; announced: MarkInfo[] } {
  const names = new Map(voices.map((v) => [v.id, v.name]));
  const byVoice = new Map<number, Lane>();
  const lane = (id: number, name: string | null): Lane => {
    let l = byVoice.get(id);
    if (l === undefined) {
      l = {
        voice: id,
        label: names.get(id) ?? name ?? `#${id}`,
        hue: voiceHue(id),
        marks: [],
        from: Number.NEGATIVE_INFINITY,
        to: Number.POSITIVE_INFINITY,
      };
      byVoice.set(id, l);
    }
    return l;
  };
  const announced: MarkInfo[] = [];
  for (const m of marks) {
    if (m.voice === null) {
      announced.push(m);
      continue;
    }
    const l = lane(m.voice, m.name);
    l.marks.push(m);
    if (m.mark === 'start') l.from = m.at;
    if (m.mark === 'end') l.to = m.at;
  }
  for (const v of voices) if (playing.has(v.state)) lane(v.id, v.name);
  const lanes = [...byVoice.values()].sort((a, b) => a.from - b.from || a.voice - b.voice);
  return { lanes, announced };
}

/**
 * The span the plan and plots share: back to the first sample, or the earliest mark within the
 * plots' window, and ahead `AHEAD_MS`, stretched to the furthest mark up to `AHEAD_CAP_MS`.
 */
export function axisOf(
  head: number,
  times: readonly number[],
  marks: readonly MarkInfo[],
): [number, number] {
  const first = times[0];
  const last = times[times.length - 1];
  if (!Number.isFinite(head)) return [first ?? 0, Math.max((first ?? 0) + 1, last ?? 1)];
  let earliest = head - AHEAD_MS;
  let furthest = head + AHEAD_MS;
  for (const m of marks) {
    if (m.at < earliest) earliest = m.at;
    if (m.at > furthest) furthest = m.at;
  }
  const from = first ?? Math.max(head - WINDOW_MS, earliest);
  const to = Math.max(Math.min(furthest, head + AHEAD_CAP_MS), last ?? head);
  return [from, Math.max(from + 1, to)];
}
