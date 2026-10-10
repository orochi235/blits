import { bareRows, clock, Sampled, unbare } from './bare.js';
import { clampWeight, passAt, phaseAt, weighed } from './clock.js';
import { closed } from './closed.js';
import type { Curve } from './easing.js';
import { KeyRows } from './keyrows.js';
import { Arg, frozenAt, type Laned, Per, type Positions, Row, SPARSE } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Motions } from './motions.js';
import type { Scratch } from './patch.js';
import { move } from './sample.js';
import type { Subject, Voice } from './voice.js';

/**
 * Whether a laned voice belongs in a crowd: one naming a single subject, which shares nothing
 * across subjects for a lane to save. A motion voice writes one channel; a keys or fn voice may
 * write several, and joins the crowd of voices writing those same channels.
 */
export function crowdable<I, O>(v: Voice<I, O>): boolean {
  return (
    v.named !== null &&
    v.named.size === 1 &&
    v.spec.locus === undefined &&
    (v.slots.length === 1 || v.motion === undefined)
  );
}

/** The law of a row that has none, a keys or fn voice's. */
export const none = new Float64Array(0);

/** Per row of a crowd's `hot`: what the fill reads of the row's voice and its current stretch. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum Hot {
  FLAGS = 0,
  NOW = 1,
  ELAPSED = 2,
  RATE = 3,
  /** The voice's weight, held to 0..1. */
  WEIGHT = 4,
  SEEKS = 5,
  EPOCH = 6,
  ID = 7,
  AT = 8,
  MS = 9,
  /** `x0`, `v0` and `to`, `axes` numbers each. */
  X0 = 10,
}

/** A crowd row's flags, at `Hot.FLAGS`. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
export const enum Flag {
  /** The voice is playing: live, frozen or fading. */
  PLAYING = 1,
  /** Its weight and clock are `hot`'s: no fade in or out, rate ramp, subject ramp or kept state. */
  FAST = 2,
  /** Its stretch changed since `hot` copied it. */
  STALE = 4,
  /** `hot` holds its stretch, with nothing pending and no earlier stretch kept. */
  BARE = 8,
  /** A probe has met its subject, so its per-subject numbers are set. */
  PLACED = 16,
  /** Its samples fold as the channel's axes, a number for a number and an array for an array. */
  FOLDS = 32,
  /** Something on the voice changed since `hot` copied it. */
  VOICE = 64,
  /** The row's voice is a motion voice; otherwise its patch is keys or a stateless fn. */
  MOTION = 128,
  /** The voice freezes before or after, so its clock is read from the voice. */
  FREEZES = 256,
  /** A keys row whose stops `keys` holds, at `Hot.AT`, with its duration at `Hot.X0` and passes at `Hot.MS`. */
  FLAT = 512,
  /** The row's patch is a tween. */
  TWEEN = 1024,
}

/** The flags of a row `bareRows` takes, under `BARE_MASK`. */
// biome-ignore lint/suspicious/noConstEnum: inlined by tsc, which builds the package; see `Row`
const enum Bare {
  // biome-ignore lint/style/useLiteralEnumMembers: tsc folds the flags into a literal
  MASK = Flag.PLAYING |
    Flag.FAST |
    Flag.BARE |
    Flag.PLACED |
    Flag.FOLDS |
    Flag.VOICE |
    Flag.MOTION |
    Flag.FREEZES |
    Flag.FLAT |
    Flag.TWEEN,
  // biome-ignore lint/style/useLiteralEnumMembers: tsc folds the flags into a literal
  WANT = Flag.PLAYING | Flag.FAST | Flag.BARE | Flag.PLACED | Flag.FOLDS | Flag.MOTION | Flag.TWEEN,
}

/** Whether a row's flags let `bareRows` take it. */
export function bare(f: number): boolean {
  return (f & Bare.MASK) === Bare.WANT;
}

/**
 * Every laned voice on one channel that reaches a single subject, a row each, in voice order: the
 * per-subject numbers a lane keeps, and a copy of what a fill reads of the voice and, for a motion
 * voice, its patch, so a fill over 100k of them reads a few flat arrays instead of 100k voices,
 * lanes and patch buffers. Each copy is written when its source changes: the voice's by
 * `voiceChanged`, the stretch by `stretchChanged`.
 */
export class Crowd<I, O> implements Positions<I, O> {
  /** The subject number at each row. */
  list: number[] = [];
  /** `STRIDE` numbers per row, laid out as a lane's. */
  data = new Float64Array(0);
  hot = new Float64Array(0);
  readonly stride: number;
  samples = new Float64Array(0);
  deltas: (Record<string, unknown> | null)[] = [];
  records: (Subject<unknown> | undefined)[] = [];
  voices: Voice<I, O>[] = [];
  motions: (Motions<I> | undefined)[] = [];
  eases: (Curve | undefined)[] = [];
  /** Each row's patch law, one array shared by every row whose law is the same. */
  laws: Float64Array[] = [];
  readonly rowOf = new Map<number, number>();
  idle = false;
  readonly line = SPARSE.other;
  /** Where the fill now under way has reached. */
  cursor = 0;
  /** Rows whose voices have left, kept in place until the crowds are next rebuilt. */
  dead = 0;
  /** Whether some row is `Flag.STALE`, for `freshen` to copy before the fill's loop. */
  stale = false;
  readonly xs: Float64Array;
  readonly vs: Float64Array;
  /** What a keys row reads into, folded before the next row reads. */
  readonly delta: Record<string, unknown> = {};
  /** The stops of its `Flag.FLAT` keys rows. */
  keys = new KeyRows();
  readonly scratch: Scratch = [];
  /** The last fill that ran the crowd's rows, and its `now`, which a `Sampled.BARE` row was sampled at. */
  bareFill = -1;
  bareNow = Number.NaN;

  constructor(
    readonly chans: Laned[],
    readonly axes: number,
  ) {
    this.stride = Hot.X0 + 3 * axes;
    this.xs = new Float64Array(axes);
    this.vs = new Float64Array(axes);
  }

  voiceAt(p: number): Voice<I, O> {
    return this.voices[p] as Voice<I, O>;
  }

  fix(p: number): void {
    unbare(this, p);
  }

  numbered(): void {}

  /** Marks row `p` to copy its stretch from its patch again before the next fill reads it. */
  restale(p: number, flags: number): void {
    this.hot[p * this.stride + Hot.FLAGS] = flags | Flag.STALE;
    this.stale = true;
  }

  /** Samples of another width than the channel's, which `samples` cannot hold, by row. */
  odd: Map<number, Float64Array> | null = null;

  keep(p: number, xs: Float64Array, n: number): void {
    if (n === this.axes) {
      for (let a = 0; a < n; a++) this.samples[p * n + a] = xs[a] as number;
      this.odd?.delete(p);
      return;
    }
    this.odd ??= new Map();
    this.odd.set(p, xs.slice(0, n));
  }

  kept(p: number, xs: Float64Array): void {
    const odd = this.odd?.get(p);
    if (odd !== undefined) {
      xs.set(odd);
      return;
    }
    const n = this.axes;
    for (let a = 0; a < n; a++) xs[a] = this.samples[p * n + a] as number;
  }

  motionAt(p: number): Motions<I> | undefined {
    return this.motions[p];
  }

  get size(): number {
    return this.list.length;
  }

  /** Makes room for `rows` rows. */
  reserve(rows: number): void {
    if (rows * Row.STRIDE <= this.data.length) return;
    const cap = Math.max(rows, (this.data.length / Row.STRIDE) * 2, 16);
    const data = new Float64Array(cap * Row.STRIDE);
    data.set(this.data);
    this.data = data;
    const hot = new Float64Array(cap * this.stride);
    hot.set(this.hot);
    this.hot = hot;
    const samples = new Float64Array(cap * this.axes);
    samples.set(this.samples);
    this.samples = samples;
  }
}

/** Runs every crowd's rows whose voices come before voice `id`, from where each crowd reached. */
export function crowdsUpTo<I, O>(lanes: Lanes<I, O>, id: number): void {
  if (!lanes.overlap) {
    for (const c of lanes.crowds) if (!c.idle && c.cursor < c.size) runCrowd(lanes, c, id);
    return;
  }
  // Crowds sharing a channel take turns in voice order, so a subject's rows fold as one crowd's do.
  for (;;) {
    let first: Crowd<I, O> | undefined;
    let a = id;
    let b = id;
    for (const c of lanes.crowds) {
      if (c.idle || c.cursor >= c.size) continue;
      const next = c.hot[c.cursor * c.stride + Hot.ID] as number;
      if (next < a) {
        b = a;
        a = next;
        first = c;
      } else if (next < b) b = next;
    }
    if (first === undefined) return;
    runCrowd(lanes, first, b);
  }
}

/** A crowd's rows from its cursor up to voice `id`, bare tweens in `bareRows` and the rest here. */
function runCrowd<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, id: number): void {
  const list = c.list;
  const hot = c.hot;
  let p = c.cursor;
  for (;;) {
    p = bareRows(lanes, c, p, id);
    if (p >= list.length || (hot[p * c.stride + Hot.ID] as number) >= id) break;
    p = rows(lanes, c, p, id);
  }
  c.cursor = p;
}

/**
 * A crowd's rows from `p` up to voice `id`, until one `bareRows` takes after the first: what
 * `runMotion` does for a lane's subjects, reading each row's voice and stretch from `hot`, and
 * through `move` for whatever `hot` cannot answer, as `runMotion` does. Returns where it stopped.
 */
function rows<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, first: number, id: number): number {
  const data = c.data;
  const hot = c.hot;
  const H = c.stride;
  const per = lanes.per;
  const arg = lanes.arg;
  const list = c.list;
  const ch = c.chans[0] as Laned;
  const n = c.axes;
  const fills = lanes.fills;
  const from = lanes.frameProbes;
  const probed = lanes.probes !== from;
  const now = lanes.now;
  const xs = c.xs;
  const vs = c.vs;
  const samples = c.samples;
  let p = first;
  for (; p < list.length; p++) {
    const h = p * H;
    if ((hot[h + Hot.ID] as number) >= id) break;
    let f = hot[h + Hot.FLAGS] as number;
    if (p > first && bare(f)) break;
    if (data[p * Row.STRIDE + Row.SAMPLED] === Sampled.BARE) unbare(c, p);
    if ((f & Flag.VOICE) !== 0) f = copyVoice(c, p);
    if ((f & Flag.PLAYING) === 0 || (f & Flag.PLACED) === 0) continue;
    const slot = list[p] as number;
    const o = p * Row.STRIDE;
    const q = slot * Per.SLOT;
    if (per[q + Per.LANE_FILL] === fills - 1) data[o + Row.PROBED] = data[o + Row.WEIGHT] as number;
    if (lanes.lately >= 0 && lanes.unread(slot)) continue;
    const delay = data[o + Row.DELAY] as number;
    const fast = (f & Flag.FAST) !== 0;
    const voice = c.voices[p] as Voice<I, O>;
    const elapsedNow = fast ? clock(hot, h, now) : voice.elapsedAt(now);
    let elapsed = elapsedNow - delay;
    if ((f & Flag.FREEZES) !== 0) elapsed = frozenAt(voice, elapsed);
    if (!(elapsed >= 0)) {
      data[o + Row.WEIGHT] = 0;
      continue;
    }
    let w: number;
    if (fast) w = hot[h + Hot.WEIGHT] as number;
    else if (typeof voice.spec.weight === 'function') {
      // The envelope first: it may call out, and `signalled` reads `arg` as it starts.
      const fade = lanes.host.envelope(voice, data[o + Row.SINCE] as number);
      arg[Arg.ELAPSED] = elapsed;
      arg[Arg.PASS] = passAt(elapsed, voice.duration, voice.passes);
      arg[Arg.FADE] = fade;
      if (!lanes.signalled(voice, slot, c.records[p] as Subject<unknown>)) {
        data[o + Row.WEIGHT] = 0;
        continue;
      }
      w = arg[Arg.WEIGHT] as number;
    } else
      w = weighed(
        voice.weight,
        lanes.host.envelope(voice, data[o + Row.SINCE] as number),
        lanes.parting(voice, slot),
      );
    data[o + Row.WEIGHT] = w;
    if ((f & Flag.FLAT) !== 0) {
      if (w > 0)
        c.keys.fold(
          hot[h + Hot.AT] as number,
          phaseAt(elapsed, hot[h + Hot.X0] as number, hot[h + Hot.MS] as number),
          c.chans,
          slot,
          w,
        );
      continue;
    }
    arg[Arg.ELAPSED] = elapsed;
    arg[Arg.DELAY] = delay;
    arg[Arg.WEIGHT] = w;
    if ((f & Flag.MOTION) === 0) {
      lanes.row(c, p, voice, slot);
      continue;
    }
    if (data[o + Row.MET] === 0) {
      if (Number.isNaN((c.records[p] as Subject<unknown>).probed)) {
        lanes.late.push(slot);
        continue;
      }
      data[o + Row.MET] = 1;
    }
    const ms = data[o + Row.MSLOT] as number;
    if (
      ms < 0 ||
      (f & Flag.BARE) === 0 ||
      (probed &&
        ((per[q + Per.LANE_PROBE] as number) > from ||
          (per[q + Per.GENERAL_PROBE] as number) > from))
    ) {
      const run = c.motions[p] as Motions<I>;
      move(lanes, c, run, p, slot, c.records[p] as Subject<unknown>);
      // The first sample numbered the subject in the patch: copy its stretch from the next fill.
      if (ms < 0) c.restale(p, hot[h + Hot.FLAGS] as number);
      continue;
    }
    closed(
      c.laws[p] as Float64Array,
      c.eases[p],
      n,
      hot[h + Hot.AT] as number,
      hot[h + Hot.MS] as number,
      hot,
      h + Hot.X0,
      hot,
      h + Hot.X0 + n,
      hot,
      h + Hot.X0 + 2 * n,
      elapsed,
      xs,
      vs,
    );
    for (let a = 0; a < n; a++) samples[p * n + a] = xs[a] as number;
    if (c.deltas[p] !== null) c.deltas[p] = null;
    data[o + Row.SAMPLED] = fills;
    data[o + Row.SEEKS] = hot[h + Hot.SEEKS] as number;
    if (w <= 0) continue;
    if ((f & Flag.FOLDS) !== 0) lanes.foldRun(ch, slot, xs);
    else lanes.foldInto(ch, slot, (c.motions[p] as Motions<I>).value(ms, xs));
  }
  return p;
}

/**
 * A keys or fn row's contribution, as `one` makes a lane position's, at the voice time, delay and
 * weight in `Arg`.
 */
export function row<I, O>(
  this: Lanes<I, O>,
  c: Crowd<I, O>,
  p: number,
  voice: Voice<I, O>,
  slot: number,
): void {
  const arg = this.arg;
  const elapsed = arg[Arg.ELAPSED] as number;
  const duration = voice.duration;
  arg[Arg.PHASE] = phaseAt(elapsed, duration, voice.passes);
  if (voice.built !== null) {
    if ((arg[Arg.WEIGHT] as number) > 0) this.foldKeys(voice, c.chans, slot);
    return;
  }
  const rec = c.records[p] as Subject<unknown>;
  if (Number.isNaN(rec.probed)) {
    this.late.push(slot);
    return;
  }
  arg[Arg.PASS] = passAt(elapsed, duration, voice.passes);
  this.call(voice, c.chans, rec, slot);
}

/** Copies what a fill reads of a crowd row's voice into `hot`; returns the row's flags. */
function copyVoice<I, O>(c: Crowd<I, O>, p: number): number {
  const v = c.voices[p] as Voice<I, O>;
  const h = p * c.stride;
  let f =
    (c.hot[h + Hot.FLAGS] as number) & ~(Flag.VOICE | Flag.PLAYING | Flag.FAST | Flag.FREEZES);
  if (v.state === 'live' || v.state === 'frozen' || v.state === 'fading') f |= Flag.PLAYING;
  if (v.freezesBefore || v.freezesAfter) f |= Flag.FREEZES;
  if (
    v.ramp === null &&
    v.owner === null &&
    !((v.fade.in ?? 0) > 0) &&
    v.out === null &&
    v.back === null &&
    v.parts === null &&
    !v.keeping &&
    typeof v.spec.weight !== 'function'
  )
    f |= Flag.FAST;
  c.hot[h + Hot.NOW] = v.anchorNow;
  c.hot[h + Hot.ELAPSED] = v.anchorElapsed;
  c.hot[h + Hot.RATE] = v.rate;
  c.hot[h + Hot.WEIGHT] = clampWeight(v.weight);
  c.hot[h + Hot.SEEKS] = v.seeks;
  c.hot[h + Hot.FLAGS] = f;
  return f;
}

/**
 * Copies stale motion rows' stretches as a fill begins: inside `runCrowd`, once voices came and
 * went, TurboFan spent its inlining on the copy and stopped inlining every row's ease.
 */
export function freshen<I, O>(c: Crowd<I, O>): void {
  c.stale = false;
  const hot = c.hot;
  const H = c.stride;
  for (let p = 0; p < c.list.length; p++) {
    const f = hot[p * H + Hot.FLAGS] as number;
    if ((f & Flag.STALE) === 0 || (f & Flag.MOTION) === 0) continue;
    // A row with no stretch yet is marked again once its first sample numbers it.
    const ms = c.data[p * Row.STRIDE + Row.MSLOT] as number;
    if (ms >= 0) copyStretch(c, p, ms);
  }
}

/** Copies a crowd row's current stretch from its patch into `hot`; returns the row's flags. */
function copyStretch<I, O>(c: Crowd<I, O>, p: number, ms: number): number {
  unbare(c, p);
  const run = c.motions[p] as Motions<I>;
  const h = p * c.stride;
  let f = (c.hot[h + Hot.FLAGS] as number) & ~(Flag.STALE | Flag.BARE | Flag.FOLDS);
  const ch = c.chans[0] as Laned;
  if (run.n === c.axes && run.stretchInto(ms, c.hot, h + Hot.AT)) {
    f |= Flag.BARE;
    if (run.scalar(ms) === ch.scalar) f |= Flag.FOLDS;
  }
  c.hot[h + Hot.FLAGS] = f;
  return f;
}
