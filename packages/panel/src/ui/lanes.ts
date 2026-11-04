import type { MarkInfo, VoiceInfo } from '../protocol.js';
import { AHEAD_CAP_MS, AHEAD_MS, WINDOW_MS } from '../store.js';
import { voiceHue } from './hue.js';

/** One voice's stretch of the plan. */
export interface Span {
  voice: number;
  label: string;
  marks: MarkInfo[];
  /** Its start, or -Infinity where that lies before what was listed. */
  from: number;
  /** Its end, or Infinity where none is known: it loops for good, or ends past the cap. */
  to: number;
}

/** One row of the plan: a track's voices, or a voice with no track on its own. */
export interface Lane {
  /** The track's name, or `#` and the voice's id for a voice with none. */
  key: string;
  label: string;
  hue: number;
  spans: Span[];
  /** Where its earliest voice starts. */
  from: number;
}

const playing = new Set(['live', 'frozen', 'fading']);

/**
 * The plan by track, earliest start first: a lane for each track, holding its voices, and one for
 * each voice with none, from what the marks list and the voices playing on without one; and the
 * marks the host announced.
 */
export function lanesOf(
  marks: readonly MarkInfo[],
  voices: readonly VoiceInfo[],
): { lanes: Lane[]; announced: MarkInfo[] } {
  const known = new Map(voices.map((v) => [v.id, v]));
  const byVoice = new Map<number, { span: Span; track: string | null }>();
  const span = (id: number, name: string | null, track: string | null) => {
    let s = byVoice.get(id);
    if (s === undefined) {
      const v = known.get(id);
      s = {
        span: {
          voice: id,
          label: v?.name ?? name ?? `#${id}`,
          marks: [],
          from: Number.NEGATIVE_INFINITY,
          to: Number.POSITIVE_INFINITY,
        },
        track: v?.track ?? track,
      };
      byVoice.set(id, s);
    }
    return s.span;
  };
  const announced: MarkInfo[] = [];
  for (const m of marks) {
    if (m.voice === null) {
      announced.push(m);
      continue;
    }
    const s = span(m.voice, m.name, m.track);
    s.marks.push(m);
    if (m.mark === 'start') s.from = m.at;
    if (m.mark === 'end') s.to = m.at;
  }
  for (const v of voices) if (playing.has(v.state)) span(v.id, v.name, v.track);

  const byKey = new Map<string, Lane>();
  for (const { span: s, track } of byVoice.values()) {
    const key = track ?? `#${s.voice}`;
    let lane = byKey.get(key);
    if (lane === undefined) {
      lane = { key, label: track ?? s.label, hue: voiceHue(s.voice), spans: [], from: s.from };
      byKey.set(key, lane);
    }
    lane.spans.push(s);
    lane.from = Math.min(lane.from, s.from);
  }
  const lanes = [...byKey.values()];
  for (const l of lanes) l.spans.sort((a, b) => a.from - b.from || a.voice - b.voice);
  lanes.sort((a, b) => a.from - b.from || (a.spans[0]?.voice ?? 0) - (b.spans[0]?.voice ?? 0));
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
