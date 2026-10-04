import { type Keyframe, mixHex } from '@msb235/blits';
import type { SampledTrack } from '@weasel-js/core';
import { toBlits, toWeasel } from './easing';
import { CHANNELS, type ChannelName, type Pose } from './kit';

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const interpolateOf = (ch: ChannelName) =>
  ch === 'offset'
    ? (a: number[], b: number[], u: number) => a.map((x, i) => lerp(x, b[i] ?? x, u))
    : ch === 'color'
      ? (a: number, b: number, u: number) => mixHex(a, b, u)
      : undefined;

const firstAt = (stops: readonly Keyframe<Pose>[], ch: ChannelName) =>
  stops.find((s) => s.delta[ch] !== undefined)?.at ?? 1;

export function tracksOf(
  stops: readonly Keyframe<Pose>[],
  period: number,
): SampledTrack<unknown>[] {
  const keyed = CHANNELS.filter((ch) => stops.some((s) => s.delta[ch] !== undefined));
  const ordered = [...keyed].sort(
    (a, b) => firstAt(stops, a) - firstAt(stops, b) || CHANNELS.indexOf(a) - CHANNELS.indexOf(b),
  );
  return ordered.map((ch) => {
    const interpolate = interpolateOf(ch);
    return {
      kind: 'sampled',
      label: ch,
      keys: stops
        .filter((s) => s.delta[ch] !== undefined)
        .map((s) => {
          const easing = toWeasel(s.ease);
          return { t: s.at * period, value: s.delta[ch], ...(easing ? { easing } : {}) };
        }),
      ...(interpolate ? { interpolate: interpolate as never } : {}),
      onTick: () => {},
    };
  });
}

export function stopsOf(
  tracks: readonly SampledTrack<unknown>[],
  period: number,
  previous: readonly Keyframe<Pose>[] = [],
): Keyframe<Pose>[] {
  const byAt = new Map<number, Keyframe<Pose>>();
  for (const track of tracks) {
    const ch = track.label as ChannelName;
    for (const key of track.keys) {
      const at = period > 0 ? Math.round((key.t / period) * 1e9) / 1e9 : 0;
      const stop = byAt.get(at) ?? { at, delta: {} };
      (stop.delta as Record<string, unknown>)[ch] = key.value;
      const ease = toBlits(key.easing);
      if (ease !== undefined) stop.ease = ease;
      byAt.set(at, stop);
    }
  }
  for (const stop of byAt.values()) {
    if (stop.ease !== undefined) continue;
    const kept = previous.find((p) => Math.abs(p.at - stop.at) < 1e-6)?.ease;
    if (kept !== undefined && toWeasel(kept) === undefined) stop.ease = kept;
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}
