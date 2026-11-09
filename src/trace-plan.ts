import { clampWeight, envelope } from './clock.js';
import { delayOf } from './delay.js';
import { type Curve, stepsOf, straight } from './easing.js';
import type { Mixer } from './mixer.js';
import type { Bent } from './trace-fit.js';
import type { Voice } from './voice.js';
import { waveAt, wavePlanOf } from './wave.js';

/**
 * What a trace knows of one subject's voices over its window, by slot: the times their shapes bend
 * or jump, the stretches they bend in, the slots a voice of unknown shape writes, and how many
 * voices of known shape write each slot.
 */
export interface Plan {
  knots: Map<number, number[]>;
  bent: Map<number, Bent[]>;
  unknown: Set<number>;
  writers: Map<number, number>;
}

export function planOf<I, O>(mix: Mixer<I, O>, subject: I, from: number, to: number): Plan {
  const plan: Plan = { knots: new Map(), bent: new Map(), unknown: new Set(), writers: new Map() };
  for (const voice of mix.cued) {
    if (voice.state === 'done' || !mix.aims(voice, subject)) continue;
    if (shapeOf(mix, voice, subject, from, to, plan)) continue;
    for (const slot of voice.slots) plan.unknown.add(slot);
  }
  for (const [slot, knots] of plan.knots)
    plan.knots.set(
      slot,
      knots.sort((a, b) => a - b).filter((t, i, all) => i === 0 || t !== all[i - 1]),
    );
  return plan;
}

/** The most breakpoints one voice may add to a window before it is read on the grid instead. */
const MOST = 4096;

/** A fade out as the mix's envelope reads it. */
interface Out {
  at: number;
  over: number;
  rest: boolean;
}

/**
 * Adds a voice's breakpoints for one subject to `plan`, and returns true, where its shape is known
 * through the window: a `keys` voice, a `wave`, or a tween with no change to come, on its own clock
 * and a number weight. Returns false, adding nothing, for any other.
 */
function shapeOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  subject: I,
  from: number,
  to: number,
  plan: Plan,
): boolean {
  const spec = voice.spec;
  const built = voice.built;
  const patch = voice.patch;
  const motion = voice.motion;
  const tweened = motion !== undefined && motion.ease !== undefined && !motion.round;
  const waved = wavePlanOf(patch);
  if (!tweened && waved === undefined && (patch.form !== 'keys' || built === null)) return false;
  if (patch.step !== undefined) return false;
  if (typeof spec.weight === 'function' || voice.owner !== null || voice.holding !== null)
    return false;
  if (voice.fitting !== null || voice.arc !== null || voice.blend !== null) return false;
  if (spec.anchor !== undefined || spec.role !== undefined || spec.within !== undefined)
    return false;
  if (spec.stepMs !== undefined || spec.from !== undefined) return false;
  const ramp = voice.ramp;
  // A ramp between two rates going forward keeps its clock running forward, bent while it lasts.
  if (ramp !== null && !(ramp.from >= 0 && voice.state !== 'pending')) return false;
  if (!((ramp === null ? voice.rate : ramp.to) > 0)) return false;
  if (voice.parts !== null || voice.parted !== null || voice.left !== null) return false;
  // Under a mix rate, a waiting voice's start is pinned to the host's clock, where a ramp moves it.
  if (voice.state === 'pending' && mix.transport.pace !== null) return false;

  const knots: number[] = [];
  const bent: Bent[] = [];
  const bentBy = new Map<number, Bent[]>();
  // One within rounding of an end is that end, as a clock rebased or sought lands a hair off it.
  const slack = 1e-12 * Math.max(1, Math.abs(from), Math.abs(to));
  const at = (t: number): void => {
    if (t > from + slack && t < to - slack) knots.push(t);
  };
  const held = voice.sharing ? undefined : voice.subjects.get(subject);
  const delay = held?.delay ?? delayOf(voice, subject);
  // A ramp's clock inverts within rounding; a jump is read on its own side only at or after it.
  const time = (raw: number): number => {
    let t = voice.timeAt(raw + delay);
    let step = Math.abs(t) * Number.EPSILON || Number.MIN_VALUE;
    for (let i = 0; i < 64 && voice.elapsedAt(t) < raw + delay; i++, step *= 2) t += step;
    return t;
  };
  /** The subject's own time on the voice's clock at mix time `t`. */
  const own = (t: number): number => voice.elapsedAt(t) - delay;
  const e0 = own(from);
  /** An easing run from 0 at the subject's own time `r0` to 1 at `r1`. */
  const easeOver = (r0: number, r1: number, ease: Curve): Bent => [
    time(r0),
    time(r1),
    (t) => ease(clampWeight((own(t) - r0) / (r1 - r0))),
  ];

  if (ramp !== null) {
    const done = voice.anchorNow + ramp.over;
    at(done);
    if (done > from) bent.push([voice.anchorNow, done, own]);
  }

  const duration = voice.duration;
  const span = voice.span;
  at(voice.start);
  at(time(0));
  if (Number.isFinite(span)) at(time(span));
  const ends = voice.endsAt();
  at(ends);

  // A voice sharing one record shows every subject from its time; one not met yet, from when it
  // will be met, as its record will be made.
  const shown =
    (voice.sharing ? voice.everyone?.shown : held?.shown) ??
    mix.shownOf(voice, mix.sinceOf(voice, delay));
  const env = envelopeOf(mix, voice, shown, ends, from, to);
  if (env === false) return false;
  for (const t of env.knots) at(t);
  // It leaves when its latest subject ends, which a subject first met later can move.
  if (!voice.freezesAfter && Number.isFinite(ends) && spec.stagger !== undefined)
    bent.push([time(span), Number.POSITIVE_INFINITY]);

  if (tweened) {
    // A tween eases from where its stretch was released to its goal, and holds there.
    const seg = motion.ahead(subject, e0);
    if (seg === undefined || seg.x0.length !== 1) return false;
    const stretch = easeOver(seg.at, seg.at + seg.ms, motion.ease as Curve);
    at(stretch[0]);
    at(stretch[1]);
    if (stretch[1] > from) bent.push(stretch);
  }

  if (duration > 0 && built !== null) {
    const first = Math.max(0, Math.floor(e0 / duration));
    const last = Math.min(Math.ceil(voice.passes) - 1, Math.floor(own(to) / duration));
    let stops = 0;
    for (const track of built.tracks) stops += track.all.length + 1;
    if ((last - first + 1) * stops > MOST) return false;
    for (let pass = first; pass <= last; pass++) {
      const base = pass * duration;
      at(time(base));
      at(time(base + duration));
      for (const track of built.tracks) {
        const slot = mix.slotOf.get(track.channel) as number;
        if (track.numbers === null) return false;
        const wait = track.delay;
        if (wait >= duration) continue;
        if (wait > 0) at(time(base + wait));
        let before = Number.NaN;
        for (const pt of track.all) {
          const raw = base + wait + clampWeight(pt.at) * (duration - wait);
          at(time(raw));
          const ease = pt.ease;
          const steps = ease === undefined ? undefined : stepsOf(ease);
          // Steps hold still between their jumps, so each jump is a breakpoint like any other.
          if (!Number.isNaN(before) && steps !== undefined)
            for (let j = 1; j < steps; j++) at(time(before + ((raw - before) * j) / steps));
          else if (!Number.isNaN(before) && !straight(ease) && raw > before) {
            const list = bentBy.get(slot);
            const span = easeOver(before, raw, ease as Curve);
            if (list === undefined) bentBy.set(slot, [span]);
            else list.push(span);
          }
          before = raw;
        }
      }
    }
  }

  if (duration > 0 && waved !== undefined) {
    const { shape, cycles, start } = waved;
    const first = Math.max(0, Math.floor(e0 / duration));
    const last = Math.min(Math.ceil(voice.passes) - 1, Math.floor(own(to) / duration));
    if ((last - first + 1) * (4 * cycles + 3) > MOST) return false;
    for (let pass = first; pass <= last; pass++) {
      const base = pass * duration;
      at(time(base));
      at(time(base + duration));
      if (shape === 'sine') {
        const x = (t: number): number => cycles * clampWeight((own(t) - base) / duration) + start;
        bent.push([time(base), time(base + duration), (t) => waveAt('sine', x(t))]);
        continue;
      }
      // The other shapes run straight between quarters of a cycle, turning or jumping at them.
      for (let k = Math.ceil(4 * start); k <= 4 * (cycles + start); k++)
        at(time(base + (duration * (k / 4 - start)) / cycles));
    }
  }

  for (const slot of voice.slots) {
    const times = plan.knots.get(slot);
    if (times === undefined) plan.knots.set(slot, [...knots]);
    else times.push(...knots);
    plan.writers.set(slot, (plan.writers.get(slot) ?? 0) + 1);
    const mine = faded([...bent, ...(bentBy.get(slot) ?? [])], env.moving);
    if (mine.length === 0) continue;
    const list = plan.bent.get(slot);
    if (list === undefined) plan.bent.set(slot, mine);
    else list.push(...mine);
  }
  return true;
}

/** Where a voice's fade moves through the window, and its value. */
interface Moving {
  spans: (readonly [lo: number, hi: number])[];
  f: (t: number) => number;
}

/**
 * The voice's fades through the window: the times they bend or jump, and where they move, null
 * where they stand still through it; false where they cannot be known.
 */
function envelopeOf<I, O>(
  mix: Mixer<I, O>,
  voice: Voice<I, O>,
  since: number,
  ends: number,
  from: number,
  to: number,
): { knots: number[]; moving: Moving | null } | false {
  const reduced = mix.reduced;
  const fadeIn = reduced ? 0 : (voice.fade.in ?? 0);
  let out: Out | null = null;
  if (voice.state === 'fading') {
    const o = voice.out;
    if (o === null || o.rest || o.back === true || o.stays === true) return false;
    if (o.deadline !== undefined) return false;
    out = o;
  } else {
    const plain = !voice.freezesAfter && !voice.freezesBefore;
    const fadeOut = (at: number, set: number): Out => ({
      at,
      over: reduced ? 0 : Number.isNaN(set) ? (voice.fade.out ?? 0) : set,
      rest: false,
    });
    // A fade set ahead begins then, unless the voice's own end comes first.
    if (Number.isFinite(voice.outAt) && !(plain && ends < voice.outAt))
      out = fadeOut(Math.max(voice.start, voice.outAt), voice.outOver);
    // Ended before its start, as a seek past its end leaves it, it fades from its start.
    else if (!voice.freezesAfter && Number.isFinite(ends))
      out = fadeOut(Math.max(voice.start, ends), voice.outOver);
  }

  const knots: number[] = [];
  const spans: (readonly [number, number])[] = [];
  const moves = (a: number, b: number): void => {
    if (!(b >= from && a <= to)) return;
    knots.push(a, b);
    if (b > a && b > from && a < to) spans.push([a, b]);
  };
  if (fadeIn > 0) {
    let stood = 0;
    const stalls = voice.stalls;
    if (stalls !== null)
      for (let i = 0; i < stalls.length; i += 2)
        stood += Math.max(0, (stalls[i + 1] as number) - Math.max(stalls[i] as number, since));
    moves(since, since + fadeIn + stood);
  }
  const back = voice.back;
  if (back !== null && !reduced) moves(back.at, back.at + (1 - back.from) * back.over);
  if (out !== null) moves(out.at, out.at + out.over);
  if (spans.length === 0) return { knots, moving: null };
  // Weighed above 1, a fade would be held to 1 partway, at a time no voice names.
  if (!(voice.weight >= 0 && voice.weight <= 1)) return false;
  const ease = voice.ease;
  const stalls = voice.stalls;
  const f = (t: number): number =>
    envelope(
      fadeIn,
      out !== null && t >= out.at ? out : null,
      ease,
      reduced,
      t,
      since,
      back,
      stalls,
    );
  return { knots, moving: { spans, f } };
}

/**
 * A voice's bends once its fade multiplies its value: where the fade moves, the fade itself, it
 * times the time, and it times each of the voice's own bends, each of which the fit weighs.
 */
function faded(own: Bent[], env: Moving | null): Bent[] {
  if (env === null) return own;
  const f = env.f;
  const out: Bent[] = [...own];
  for (const [lo, hi] of env.spans) {
    out.push([lo, hi, f], [lo, hi, (t) => (t - lo) * f(t)]);
    for (const b of own) {
      const g = b[2];
      const a = Math.max(b[0], lo);
      const z = Math.min(b[1], hi);
      if (!(z > a)) continue;
      out.push(g === undefined ? [a, z] : [a, z, (t) => f(t) * g(t)]);
    }
  }
  return out;
}
