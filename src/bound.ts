import { unband } from './fold.js';
import { keepProbed, type Lane, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import { carried } from './near.js';
import type { Places } from './places.js';
import type { Circle, Setting, VoiceSpec } from './types.js';
import type { Voice } from './voice.js';
import { production, warnOnce } from './warn.js';

/**
 * A voice's signal declared 0 outside a circle around a point the host moves (`within` on the
 * cue), over positions the host gives the mix (`plot`). Outside it the voice is not read at all,
 * which is what lets a lane fill visit only the subjects within it.
 */

/** How many frames apart, outside production, a bound reads its signal just beyond the circle. */
const CHECK_EVERY = 8;
/** How many subjects beyond the circle each such check reads. */
const CHECK_SUBJECTS = 4;

export class Bound<I, O> {
  /** The frame `x`, `y` and `r` were read from `area` in. */
  frame = Number.NaN;
  x = 0;
  y = 0;
  r = 0;
  r2 = 0;
  /**
   * Subject numbers whose lane weight or probed weight may not be 0: those the last fill found
   * within, those it zeroed and a probe has yet to read 0 from, and those the general path paid.
   */
  lit: number[] = [];
  spare: number[] = [];
  /**
   * By subject number, the fill that last found it within (negated where that fill let it go), and
   * the fill that last put it in `lit`.
   */
  inAt = new Float64Array(0);
  litAt = new Float64Array(0);
  /** Outside production until it has warned: whether it checks the circle clips no signal. */
  checks: boolean;
  frames = 0;

  constructor(
    readonly mix: Mixer<I, O>,
    readonly voice: Voice<I, O>,
    readonly area: Circle,
  ) {
    this.checks = !production();
  }
}

/**
 * Why a voice could not be bounded, or null: reads a skipped subject could not leave as they were,
 * on one with state, a locus, history, an owner, `from: 'current'`, or subjects of its own.
 */
function refusal<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): string | null {
  const patch = spec.patch;
  return mix.opts.history !== undefined
    ? 'a mix with history'
    : spec.subjects !== undefined
      ? 'a voice naming its subjects'
      : spec.locus !== undefined
        ? 'a voice in a locus'
        : spec.from === 'current'
          ? "a voice cued from: 'current'"
          : spec.owner !== undefined
            ? 'a voice an owner holds'
            : patch.form === 'motion' || patch.state !== undefined || patch.step !== undefined
              ? 'a patch keeping state'
              : null;
}

/** Refuses a cue's `within` where the mix has no positions, and on a voice `refusal` names. */
export function checkWithin<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): void {
  const area = spec.within;
  if (area === undefined) return;
  if (typeof area !== 'object' || area === null)
    throw new TypeError('blits: within takes a circle, { x, y, r }');
  if (mix.places === null) throw new Error('blits: within needs positions: call mix.plot first');
  if (typeof spec.weight !== 'function') throw new Error('blits: within needs a weight signal');
  const refused = refusal(mix, spec);
  if (refused !== null) throw new Error(`blits: within is not taken on ${refused}`);
}

/**
 * Bounds a voice just made to its cue's `within`, or to the circle its `near` weight carries where
 * it could take one. A carried circle is the signal's own edge, so it is not checked.
 */
export function bind<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const spec = voice.spec;
  const own = carried(spec.weight);
  const area =
    spec.within ??
    (own !== undefined && mix.places !== null && refusal(mix, spec) === null ? own : undefined);
  if (area === undefined) return;
  voice.bound = new Bound(mix, voice, area);
  if (area === own) voice.bound.checks = false;
}

function snap<I, O>(b: Bound<I, O>, mix: Mixer<I, O>): void {
  if (b.frame === mix.frame) return;
  b.frame = mix.frame;
  const a = b.area;
  b.x = a.x;
  b.y = a.y;
  b.r = a.r;
  b.r2 = a.r * a.r;
  if (b.checks && ++b.frames % CHECK_EVERY === 0) check(b);
}

/**
 * Reads the signal, as at a first sight, for a few subjects just beyond the circle, and warns once
 * if any is above 0: the circle is cutting off part of the signal.
 */
function check<I, O>(b: Bound<I, O>): void {
  const places = b.mix.places as Places<I>;
  const n = places.ring(b.x, b.y, b.r);
  if (n === 0) return;
  const voice = b.voice;
  const signal = voice.spec.weight as (subject: I, setting: Setting<void, unknown>) => number;
  const now = b.mix.now;
  const setting: Setting<void, unknown> = {
    timestamp: now,
    dt: 0,
    elapsed: voice.elapsedAt(now),
    pass: voice.setting.pass,
    weight: 0,
    state: undefined,
    host: voice.setting.host,
    keep: (_owner, init) => init(),
    send: () => {},
  };
  const step = Math.max(1, Math.floor(n / CHECK_SUBJECTS));
  const from = (b.frames / CHECK_EVERY) % step;
  const found = places.found.slice(0, n);
  for (let k = from; k < n; k += step) {
    const subject = places.subjectAt(found[k] as number);
    if (subject === undefined) continue;
    const w = signal(subject, setting);
    if (w > 0) {
      b.checks = false;
      warnOnce(
        voice,
        `${voice.spec.name ?? `voice ${voice.id}`}'s weight signal reads ${w} just outside its within circle (r ${b.r}), which cuts it off there: widen r to where the signal falls to 0`,
      );
      return;
    }
  }
}

/** Whether `subject` is within the voice's bound, on the general path. */
export function inBound<I, O>(mix: Mixer<I, O>, b: Bound<I, O>, subject: I): boolean {
  const places = mix.places;
  if (places === null) return false;
  if (mix.projecting) {
    const a = b.area;
    return places.inside(subject, a.x, a.y, a.r * a.r);
  }
  snap(b, mix);
  return places.inside(subject, b.x, b.y, b.r2);
}

/** Notes that the subject at `slot` may hold a weight other than 0 on the voice's lane. */
export function lit<I, O>(b: Bound<I, O>, slot: number, fills: number): void {
  if (slot >= b.litAt.length) grow(b, slot + 1);
  if (b.litAt[slot] === fills) return;
  b.litAt[slot] = fills;
  b.lit.push(slot);
}

function grow<I, O>(b: Bound<I, O>, cap: number): void {
  if (cap <= b.inAt.length) return;
  const size = Math.max(cap, b.inAt.length * 2, 64);
  const inAt = new Float64Array(size);
  inAt.set(b.inAt);
  b.inAt = inAt;
  const litAt = new Float64Array(size);
  litAt.set(b.litAt);
  b.litAt = litAt;
}

/**
 * `run`'s loop for a bounded voice: `one` for the subjects within the bound, and for those that
 * were lit and are not, their lane weight set to 0 as a read at weight 0 leaves it.
 */
export function runBounded<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>, b: Bound<I, O>): void {
  const mix = b.mix;
  const places = mix.places as Places<I>;
  snap(b, mix);
  const fills = lanes.fills;
  grow(b, lanes.cap);
  const old = b.lit;
  b.lit = b.spare;
  b.lit.length = 0;
  b.spare = old;
  const voice = lane.voice;
  const inAt = b.inAt;
  const n = places.query(b.x, b.y, b.r, b.r2);
  const found = places.found;
  const slots = places.slots;
  for (let k = 0; k < n; k++) {
    const slot = slots[found[k] as number] as number;
    if (slot < 0 || inAt[slot] === fills) continue;
    inAt[slot] = fills;
    const p = lane.positionOf(slot);
    if (p < 0) continue;
    lit(b, slot, fills);
    places.cur = found[k] as number;
    try {
      lanes.one(lane, p, slot);
    } finally {
      places.cur = -1;
    }
    if (voice.keeping) return;
  }
  const data = lane.data;
  const per = lanes.per;
  for (let k = 0; k < old.length; k++) {
    const slot = old[k] as number;
    // Within, or already let go of this fill: a second `keepProbed` would copy the 0 just written.
    if (inAt[slot] === fills || inAt[slot] === -fills) continue;
    inAt[slot] = -fills;
    const p = lane.positionOf(slot);
    if (p < 0) continue;
    const o = p * Row.STRIDE;
    keepProbed(data, o, per, slot * Per.SLOT, fills);
    if (data[o + Row.WEIGHT] !== 0) {
      data[o + Row.WEIGHT] = 0;
      unband(lane.records[p]);
    }
    if (data[o + Row.PROBED] !== 0) lit(b, slot, fills);
  }
}
