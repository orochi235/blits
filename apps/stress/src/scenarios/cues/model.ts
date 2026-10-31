import { BACK_MS, type Cue, FRAME_MS, GROUPS, groupOf, type Show } from './script';

interface Pose {
  level: Float64Array;
  hue: Float64Array;
}

/** One cue as the desk plays it: a fade from where the stage was, or BACK's crossfade. */
interface Part {
  index: number;
  cue: Cue;
  start: number;
  /** BACK's part holds its levels and comes in by weight over `BACK_MS`. */
  back: boolean;
  /** What its fade starts from, per fixture; unset until it starts. */
  from?: Pose;
  /** How fast each fixture was moving as it started, per ms; unset where its fade runs straight. */
  slope?: Pose;
  /** When the next follow in its chain starts, and it leaves at once. */
  out?: number;
  /** When BACK began fading it out. */
  fadeAt?: number;
}

/**
 * How a `from: 'current'` fade leaves where the stage was. `docs`: straight along its stops, as
 * blending.mdx says ("it carries position, not speed"). `carry`: as CHANGELOG 0.2.0 says, at the
 * speed the fixture had over the last two frames read, once two are on record.
 */
export type Reading = 'docs' | 'carry';

/**
 * The cue stack in plain arithmetic, replaying the operator's actions. It is the reference blits is
 * checked against, so it reads nothing of blits.
 */
export function model(s: Show, reading: Reading) {
  const n = s.fixtures;
  const count = s.cues.length;
  const level = new Float64Array(n);
  const hue = new Float64Array(n);
  /** What the last frame showed, and the one before. */
  let shown: Pose = { level: new Float64Array(n), hue: new Float64Array(n) };
  let before: Pose = { level: new Float64Array(n), hue: new Float64Array(n) };
  const fader = new Float64Array(GROUPS);
  let parts: Part[] = [];
  let current = -1;
  /** The first frame read with a `from: 'current'` cue on stage: blits keeps poses from then. */
  let kept = Number.POSITIVE_INFINITY;

  function begin(p: Part, f: number): void {
    // `from: 'current'` starts from what the last frame showed, every other voice folded in (blending.mdx).
    p.from = { level: shown.level.slice(), hue: shown.hue.slice() };
    if (reading !== 'carry' || f - 2 < kept) return;
    const dt = (f - 1) * FRAME_MS - (f - 2) * FRAME_MS;
    const d = (a: Float64Array, b: Float64Array) => a.map((v, i) => (v - (b[i] as number)) / dt);
    p.slope = { level: d(shown.level, before.level), hue: d(shown.hue, before.hue) };
  }

  function go(at: number, f: number): void {
    const k = (current + 1) % count;
    // GO takes over everything: a fade in progress, a follow waiting, BACK's fade out.
    parts = [];
    let prev: Part = { index: k, cue: s.cues[k] as Cue, start: at, back: false };
    begin(prev, f);
    parts.push(prev);
    for (let j = (k + 1) % count; j !== k; j = (j + 1) % count) {
      const c = s.cues[j] as Cue;
      if (c.follow === undefined) break;
      // A follow starts `follow` ms after the cue before coasts: the end of its fade (score.mdx).
      const start = prev.start + prev.cue.fadeMs + c.follow;
      prev.out = start;
      prev = { index: j, cue: c, start, back: false };
      parts.push(prev);
    }
    current = k;
    kept = Math.min(kept, f);
  }

  function back(at: number): void {
    if (current <= 0) return;
    parts = parts.filter((p) => p.start <= at);
    // A voice already fading is left as it is (Handle.fade, src/types/voice.ts).
    for (const p of parts) p.fadeAt ??= at;
    current--;
    parts.push({ index: current, cue: s.cues[current] as Cue, start: at, back: true });
  }

  /** A fade from `a` to `z` at `u`, leaving at `slope` per ms where it has one (src/patch.ts `read`). */
  const fade = (a: number, z: number, u: number, slope: number | undefined, ms: number) => {
    if (u >= 1) return z;
    const v = a + (z - a) * u;
    return slope === undefined ? v : v + (slope * ms - (z - a)) * u * (1 - u) * (1 - u);
  };

  /** Plays frame `f`: the operator's actions, made at the last sync's time, then the frame. */
  function step(f: number): void {
    const t = f * FRAME_MS;
    const was = (f - 1) * FRAME_MS;
    for (const op of s.at(f)) {
      if (op.kind === 'fader') fader[op.group] = op.to;
      else if (op.kind === 'back') back(was);
      else go(was, f);
    }
    level.fill(0);
    hue.fill(0);
    const live: Part[] = [];
    for (const p of parts) {
      if (p.start > t) {
        live.push(p);
        continue;
      }
      if (p.out !== undefined && t >= p.out) continue;
      if (p.fadeAt !== undefined && t >= p.fadeAt + BACK_MS) continue;
      live.push(p);
      if (!p.back && p.from === undefined) {
        // A follow reads the frame before it first contributes (blending.mdx).
        begin(p, f);
        current = p.index;
      }
      let w = p.back ? Math.min(1, (t - p.start) / BACK_MS) : 1;
      if (p.fadeAt !== undefined) w *= 1 - (t - p.fadeAt) / BACK_MS;
      const ms = p.cue.fadeMs;
      const u = Math.min(1, (t - p.start) / ms);
      for (let i = 0; i < n; i++) {
        let l = p.cue.levels[i] as number;
        let h = p.cue.hue;
        if (p.from) {
          l = fade(p.from.level[i] as number, l, u, p.slope?.level[i], ms);
          h = fade(p.from.hue[i] as number, h, u, p.slope?.hue[i], ms);
        }
        // `max` scales a contribution toward 0 by its weight before comparing; `sum` adds (channels.ts).
        if (w * l > (level[i] as number)) level[i] = w * l;
        hue[i] = (hue[i] as number) + w * h;
      }
    }
    parts = live;
    for (let i = 0; i < n; i++) {
      const g = groupOf(i);
      const v = (fader[g] as number) * ((s.presets[g] as Float64Array)[i] as number);
      if (v > (level[i] as number)) level[i] = v;
    }
    [before, shown] = [shown, before];
    shown.level.set(level);
    shown.hue.set(hue);
  }

  return { step, level, hue };
}
