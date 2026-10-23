import { retire } from './fade.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import { ownerReading } from './owner.js';
import { startAt } from './place.js';
import { refit } from './spans.js';
import type { ArcHandle, ArcSpec, ArcVoice, Handle, VoiceSpec } from './types.js';
import type { Voice } from './voice.js';

/** An arc's parts in the order they play: its enter, its active and its exit. */
const PARTS = ['enter', 'active', 'exit'] as const;

/** What an arc keeps beside its owner: how long its enter and exit last, which parts it has, its blend. */
export class Arc {
  constructor(
    readonly enter: number,
    readonly exit: number,
    readonly blend: number,
    /** By part, whether it has one. */
    readonly has: readonly boolean[],
    /** How long its hold lasts as cued; Infinity for one held open. */
    readonly hold: number,
  ) {}
}

/** Where each part an arc has starts and ends on its clock, for a hold of `hold`; null for a part it lacks. */
function segments(arc: Arc, hold: number): ([number, number] | null)[] {
  const bounds = [0, arc.enter, arc.enter + hold, arc.enter + hold + arc.exit];
  const end = bounds[3] as number;
  const out: ([number, number] | null)[] = [null, null, null];
  for (let p = 0; p < 3; p++) {
    if (!arc.has[p]) continue;
    let next = p + 1;
    while (next < 3 && !arc.has[next]) next++;
    out[p] = [bounds[p] as number, next < 3 ? (bounds[next] as number) : end];
  }
  return out;
}

/** Where an arc ends on its own clock: Infinity while its hold is open. */
export function arcEnd<I, O>(voice: Voice<I, O>): number {
  const arc = voice.arc as Arc;
  return arc.enter + voice.hold + arc.exit;
}

/**
 * A part's weight at `t` on its arc's clock, klieg's: up over the blend centered on where it
 * starts and down over the one where it ends, except at the arc's own start and end, where it
 * holds full weight.
 */
function rampOf(s: number, e: number, end: number, blend: number, t: number): number {
  if (e <= s) return 0;
  const half = blend / 2;
  const first = s === 0;
  const last = e === end;
  if ((!first && t < s - half) || (!last && t >= e + half)) return 0;
  const up = first ? 1 : blend > 0 ? Math.min(1, (t - s + half) / blend) : 1;
  const down = last ? 1 : blend > 0 ? Math.min(1, (e + half - t) / blend) : 1;
  return Math.min(up, down);
}

/**
 * What an arc multiplies into the weight of a voice it holds at mix time `now`: its part's ramp,
 * scaled down where a hold shorter than the blend leaves all three ramps up at once and their sum
 * would pass 1.
 */
export function arcShare<I, O>(
  arcVoice: Voice<I, O>,
  child: Voice<I, O>,
  now: number,
  reduced: boolean,
): number {
  const arc = arcVoice.arc as Arc;
  const t = ownerReading(arcVoice, now);
  // Its parts freeze on their first frames, so an arc yet to start has to silence them itself.
  if (!(t >= 0)) return 0;
  const segs = segments(arc, arcVoice.hold);
  const end = arc.enter + arcVoice.hold + arc.exit;
  const blend = reduced ? 0 : arc.blend;
  const mine = segs[child.part];
  if (mine == null) return 0;
  const own = rampOf(mine[0], mine[1], end, blend, t);
  if (own <= 0) return 0;
  let total = 0;
  for (const s of segs) if (s !== null) total += rampOf(s[0], s[1], end, blend, t);
  return total > 1 ? own / total : own;
}

/** How long a part lasts: its longest voice's `duration`, or patch duration times passes. */
function lengthOf<I, O, H>(part: readonly ArcVoice<I, O, H>[]): number {
  let most = 0;
  for (const v of part) {
    const loop = v.loop;
    const passes = loop === undefined || loop === false ? 1 : loop === true ? Infinity : loop;
    const own = v.duration ?? (v.patch.duration > 0 ? v.patch.duration * passes : 0);
    if (!(own >= 0)) throw new RangeError(`blits: an arc's part lasts 0 ms or more, not ${own}`);
    if (own > most) most = own;
  }
  return most;
}

const listOf = <T>(part: T | readonly T[] | undefined): readonly T[] | undefined =>
  part === undefined ? undefined : Array.isArray(part) ? part : [part as T];

/** Cues an arc: its owner, then each part's voices on its clock. */
export function cueArc<I, O>(mix: Mixer<I, O>, spec: ArcSpec<I, O>): ArcHandle<I> {
  if ((spec.rate ?? 1) < 0)
    throw new Error(
      'blits: an arc plays its parts forward from its start, so it is not cued backward',
    );
  if ((spec as { freeze?: unknown }).freeze !== undefined)
    throw new Error(
      'blits: an arc holds each part’s first and last frames itself, so it takes no freeze',
    );
  const { enter, active, exit, hold, blend, ...own } = spec;
  const parts = [listOf(enter), listOf(active), listOf(exit)] as (
    | readonly ArcVoice<I, O>[]
    | undefined
  )[];
  const lengths = parts.map((p) => (p === undefined ? 0 : lengthOf(p)));
  for (const p of [0, 2])
    if (!Number.isFinite(lengths[p]))
      throw new Error(`blits: an arc's ${PARTS[p]} has to end, so it cannot loop for good`);
  const held = hold === 'open' ? Number.POSITIVE_INFINITY : (hold ?? lengths[1] ?? 0);
  if (!(held >= 0)) throw new RangeError(`blits: an arc holds for 0 ms or more, not ${hold}`);
  const fade = blend ?? 0;
  if (!(fade >= 0 && Number.isFinite(fade)))
    throw new RangeError(`blits: an arc blends over 0 ms or more, not ${blend}`);
  const arc = new Arc(
    lengths[0] as number,
    lengths[2] as number,
    fade,
    parts.map((p) => p !== undefined),
    held,
  );
  mix.arcing = arc;
  let handle: Handle<I>;
  try {
    handle = mix.owns(own);
  } finally {
    mix.arcing = null;
  }
  const starts = [0, arc.enter, arc.enter + held];
  parts.forEach((part, p) => {
    for (const v of part ?? []) {
      const { duration: _, ...rest } = v;
      const child: VoiceSpec<I, O> = {
        ...(rest as Omit<VoiceSpec<I, O>, 'patch'> & Pick<VoiceSpec<I, O>, 'patch'>),
        owner: handle,
        start: starts[p] as number,
        freeze: 'both',
      };
      // The hold, not the patch, says how long the active plays, so it loops unless told otherwise.
      if (p === 1 && hold !== undefined && v.loop === undefined) child.loop = true;
      mix.cue(child);
      (mix.cued[mix.cued.length - 1] as Voice<I, O>).part = p;
    }
  });
  return handle as ArcHandle<I>;
}

/**
 * Ends an arc's hold at mix time now, so its exit begins half a blend later and its blend starts
 * now; where the enter is still playing, the exit follows it. Nothing where the exit has begun.
 */
export function release<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const arc = voice.arc;
  if (arc === null) throw new Error('blits: release ends an arc’s hold, and this is no arc');
  if (voice.state === 'done' || voice.state === 'fading') return;
  const local = ownerReading(voice, mix.now);
  const lead = arc.exit > 0 && !mix.reduced ? arc.blend / 2 : 0;
  const at = Math.max(arc.enter, local + lead);
  if (!(at < arc.enter + voice.hold)) return;
  voice.hold = at - arc.enter;
  for (const child of voice.holding?.children ?? [])
    if (child.part === 2 && child.state === 'pending') startAt(mix, child, at);
  noteArc(mix, voice);
}

/** Records an arc's new hold, and has the span holding it fit again. */
function noteArc<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  noted(mix, voice);
  if (voice.owner?.fitting) refit(mix, voice.owner);
  mix.lanes?.refill();
}

/**
 * Lets each arc's parts leave once the blend after them is over, and the arc itself at its end:
 * played, as a voice that ran its passes is.
 */
export function settleArcs<I, O>(mix: Mixer<I, O>, now: number): void {
  for (const voice of mix.owners ?? []) {
    const arc = voice.arc;
    if (arc === null || voice.state === 'done' || voice.state === 'pending') continue;
    const local = ownerReading(voice, now);
    if (!Number.isFinite(local)) continue;
    const end = arcEnd(voice);
    if (local >= end) {
      const at = voice.timeAt(end);
      voice.play(true, at, mix.transport.seq);
      retire(mix, voice, at);
      continue;
    }
    const segs = segments(arc, voice.hold);
    const half = mix.reduced ? 0 : arc.blend / 2;
    for (const child of [...(voice.holding?.children ?? [])]) {
      const s = segs[child.part];
      if (s == null || s[1] === end || child.state === 'done') continue;
      if (local >= s[1] + half) retire(mix, child, voice.timeAt(s[1] + half));
    }
  }
}

/** An arc's marks: when its enter ends, its hold ends and its exit begins and ends. */
export function arcMark<I, O>(
  voice: Voice<I, O>,
  start: number,
  mark: 'in' | 'coast' | 'out' | 'end',
): number | undefined {
  const arc = voice.arc as Arc;
  const at = (t: number) => {
    const u = voice.timeAt(t);
    return Number.isFinite(u) ? Math.max(start, u) : undefined;
  };
  if (mark === 'in') {
    const t = at(arc.enter);
    return t === undefined ? t : Math.max(t, start + (voice.fade.in ?? 0));
  }
  const coast = at(arc.enter + voice.hold);
  // Faded, or set to fade, before its hold ended: it left with no exit.
  const out = voice.out;
  const cut = out !== null ? out.at : Number.isFinite(voice.outAt) ? voice.outAt : undefined;
  const cutShort = cut !== undefined && (coast === undefined || cut < coast);
  if (mark === 'coast') return cutShort ? undefined : coast;
  if (mark === 'out') {
    if (cutShort) return cut;
    return voice.state === 'done' && coast === undefined ? voice.doneAt : coast;
  }
  if (voice.state === 'done') return voice.doneAt;
  if (cutShort) {
    if (out !== null) return out.at + out.over;
    const over = Number.isNaN(voice.outOver) ? (voice.fade.out ?? 0) : voice.outOver;
    return (cut as number) + over;
  }
  return at(arcEnd(voice));
}
