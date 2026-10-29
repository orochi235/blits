import { carried } from './around.js';
import { unband } from './fold.js';
import { keepProbed, type Lane, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Places } from './places.js';
import type { Circle, Finder, Setting, VoiceSpec } from './types.js';
import type { Voice } from './voice.js';
import { production, warnOnce } from './warn.js';

/**
 * A voice's signal declared 0 outside a bound (`within` on the cue): a circle around a point the host
 * moves, over positions the host gives the mix (`plot`, `put`), or a finder the host answers with the
 * indices `place` gave. Outside it the voice is not read at all, which is what lets a lane fill visit
 * only the subjects within it.
 */

/** How many frames apart, outside production, a bound reads its signal just beyond the circle. */
const CHECK_EVERY = 8;
/** How many subjects beyond the circle each such check reads. */
const CHECK_SUBJECTS = 4;

export class Bound<I, O> {
  /** The host's finder, or null for a circle. */
  readonly finder: Finder | null;
  /** By index, the `marks` stamp of the last time the general path found it within: see `marked`. */
  hitAt = new Float64Array(0);
  marks = 0;
  /** The frame `hitAt` was last marked in. */
  markedIn = Number.NaN;
  /** The indices a finder's check reads the signal for. */
  missed = new Int32Array(CHECK_SUBJECTS);
  /** Outside production, until it has warned: whether it checks a finder's indices. */
  vets: boolean;
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
  /** Outside production until it has warned: whether it checks the bound clips no signal. */
  checks: boolean;
  frames = 0;
  /** The `frames` count a finder's check last ran at. */
  checkedAt = -1;

  constructor(
    readonly mix: Mixer<I, O>,
    readonly voice: Voice<I, O>,
    readonly area: Circle | Finder,
  ) {
    this.finder = isFinder(area) ? area : null;
    this.checks = !production();
    this.vets = this.checks && this.finder !== null;
  }
}

const isFinder = (area: Circle | Finder): area is Finder =>
  typeof (area as Finder).find === 'function';

/** Refuses a cue's `within` where the mix has handed out no indices, or on a voice with no signal. */
export function checkWithin<I, O>(mix: Mixer<I, O>, spec: VoiceSpec<I, O>): void {
  const area = spec.within;
  if (area === undefined) return;
  if (typeof area !== 'object' || area === null)
    throw new TypeError('blits: within takes a circle, { x, y, r }, or a finder, { find(out) }');
  if (mix.places === null)
    throw new Error('blits: within needs indices: call mix.place or mix.plot first');
  if (typeof spec.weight !== 'function')
    throw new Error(
      "blits: within needs a signal weight; for a hard-edged disk use weight: mix.around(circle, { steps: 1, jump: 'start' })",
    );
}

/**
 * Bounds a voice just made to its cue's `within`, or to the circle its `around` weight carries once
 * the mix has indices. A carried circle is the signal's own edge, so it is not checked.
 */
export function bind<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const spec = voice.spec;
  const own = carried(spec.weight);
  const area = spec.within ?? (own !== undefined && mix.places !== null ? own : undefined);
  if (area === undefined) return;
  voice.bound = new Bound(mix, voice, area);
  if (area === own) voice.bound.checks = false;
}

function snap<I, O>(b: Bound<I, O>, mix: Mixer<I, O>): void {
  if (b.frame === mix.frame) return;
  b.frame = mix.frame;
  if (b.checks) b.frames++;
  if (b.finder === null) {
    const a = b.area as Circle;
    b.x = a.x;
    b.y = a.y;
    b.r = a.r;
    b.r2 = a.r * a.r;
    if (b.checks && b.frames % CHECK_EVERY === 0) {
      const places = mix.places as Places<I>;
      check(b, places.found, places.ring(b.x, b.y, b.r));
    }
  }
}

/**
 * Leaves in `places.found` the indices the bound finds this frame, and returns how many: the grid's
 * for a circle, the host's for a finder. An index no subject holds reads as no lane number.
 */
function findAll<I, O>(b: Bound<I, O>): number {
  const places = b.mix.places as Places<I>;
  snap(b, b.mix);
  const finder = b.finder;
  if (finder === null) return places.query(b.x, b.y, b.r, b.r2);
  if (places.found.length < places.n)
    places.found = new Int32Array(Math.max(places.n, places.found.length * 2));
  const out = places.found;
  const count = finder.find(out);
  if (!(Number.isInteger(count) && count >= 0 && count <= out.length))
    throw new RangeError(
      `blits: within's find returned ${count}, not a count of the indices it wrote, 0 to ${out.length}`,
    );
  places.count = count;
  if (b.vets) vet(b, out, count, places.n);
  // Once a frame, though a frame may find more than once.
  if (b.checks && b.frames % CHECK_EVERY === 0 && b.checkedAt !== b.frames) {
    b.checkedAt = b.frames;
    check(b, b.missed, miss(b, places, count));
  }
  return count;
}

/** Warns once if a finder wrote an index `place` never handed out. */
function vet<I, O>(b: Bound<I, O>, out: Int32Array, count: number, n: number): void {
  for (let k = 0; k < count; k++) {
    const i = out[k] as number;
    if (i >= 0 && i < n) continue;
    b.vets = false;
    const voice = b.voice;
    warnOnce(
      voice,
      `${voice.spec.name ?? `voice ${voice.id}`}'s within finder found index ${i}, which place never handed out: it is skipped`,
    );
    return;
  }
}

/**
 * Reads the signal, as at a first sight, for a few subjects just outside the bound, and warns once
 * if any is above 0: the bound is cutting off part of the signal. Just beyond a circle's edge; for a
 * finder, a few indices it did not find, taken in turn.
 */
function check<I, O>(b: Bound<I, O>, list: Int32Array, n: number): void {
  if (n === 0) return;
  const places = b.mix.places as Places<I>;
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
  const found = list.slice(0, n);
  const named = voice.named;
  for (let k = from; k < n; k += step) {
    const subject = places.subjectAt(found[k] as number);
    if (subject === undefined || (named !== null && !named.has(subject))) continue;
    const w = signal(subject, setting);
    if (w > 0) {
      b.checks = false;
      warnOnce(
        voice,
        b.finder === null
          ? `${voice.spec.name ?? `voice ${voice.id}`}'s weight signal reads ${w} just outside its within circle (r ${b.r}), which cuts it off there: widen r to where the signal falls to 0`
          : `${voice.spec.name ?? `voice ${voice.id}`}'s weight signal reads ${w} for a subject its within finder did not find, which cuts it off there: find every subject the signal is above 0 for`,
      );
      return;
    }
  }
}

/**
 * Marks the `count` indices a finder just found, and leaves in `missed` up to `CHECK_SUBJECTS` it did
 * not, from where the last check left off; returns how many.
 */
function miss<I, O>(b: Bound<I, O>, places: Places<I>, count: number): number {
  const stamp = mark(b, places, count);
  const n = places.n;
  const hitAt = b.hitAt;
  const from = n === 0 ? 0 : ((b.frames / CHECK_EVERY) * CHECK_SUBJECTS) % n;
  let m = 0;
  for (let k = 0; k < n && m < CHECK_SUBJECTS; k++) {
    const i = (from + k) % n;
    if (hitAt[i] !== stamp && places.subjectAt(i) !== undefined) b.missed[m++] = i;
  }
  return m;
}

/** Marks in `hitAt` the first `count` of `places.found`, as this frame's, and returns their stamp. */
function mark<I, O>(b: Bound<I, O>, places: Places<I>, count: number): number {
  b.markedIn = b.mix.frame;
  if (b.hitAt.length < places.n) b.hitAt = new Float64Array(Math.max(places.n, b.hitAt.length * 2));
  const stamp = ++b.marks;
  const found = places.found;
  const hitAt = b.hitAt;
  for (let k = 0; k < count; k++) {
    const i = found[k] as number;
    if (i >= 0 && i < hitAt.length) hitAt[i] = stamp;
  }
  return stamp;
}

/** The stamp `hitAt` carries for the indices a finder finds this frame, marked once a frame. */
function marked<I, O>(b: Bound<I, O>): number {
  if (b.markedIn === b.mix.frame) return b.marks;
  const count = findAll(b);
  // A check in `findAll` may have marked them already.
  return b.markedIn === b.mix.frame ? b.marks : mark(b, b.mix.places as Places<I>, count);
}

/** Whether `subject` is within the voice's bound, on the general path. */
export function inBound<I, O>(mix: Mixer<I, O>, b: Bound<I, O>, subject: I): boolean {
  const places = mix.places;
  if (places === null) return false;
  if (b.finder !== null) {
    const i = places.at.get(subject);
    if (i === undefined) return false;
    const stamp = marked(b);
    return b.hitAt[i] === stamp;
  }
  if (mix.projecting) {
    const a = b.area as Circle;
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
  const places = b.mix.places as Places<I>;
  const n = findAll(b);
  const fills = lanes.fills;
  grow(b, lanes.cap);
  const old = b.lit;
  b.lit = b.spare;
  b.lit.length = 0;
  b.spare = old;
  const voice = lane.voice;
  const inAt = b.inAt;
  const found = places.found;
  const slots = places.slots;
  for (let k = 0; k < n; k++) {
    const slot = slots[found[k] as number] ?? -1;
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

/**
 * For a role member's bound, before its role's loop: marks the subjects within it this fill, which
 * `inside` then reads.
 */
export function meetBound<I, O>(lanes: Lanes<I, O>, b: Bound<I, O>): void {
  const places = b.mix.places as Places<I>;
  const n = findAll(b);
  const fills = lanes.fills;
  grow(b, lanes.cap);
  const inAt = b.inAt;
  const found = places.found;
  const slots = places.slots;
  for (let k = 0; k < n; k++) {
    const slot = slots[found[k] as number] ?? -1;
    if (slot >= 0) inAt[slot] = fills;
  }
}

/** Whether `meetBound` found the subject at `slot` within the bound this fill. */
export const inside = <I, O>(b: Bound<I, O>, slot: number, fills: number): boolean =>
  b.inAt[slot] === fills;

/** A role member's subject outside its bound: its lane weight set to 0, as a read at weight 0 leaves it. */
export function leave<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>, p: number, slot: number): void {
  const data = lane.data;
  const o = p * Row.STRIDE;
  keepProbed(data, o, lanes.per, slot * Per.SLOT, lanes.fills);
  if (data[o + Row.WEIGHT] !== 0) {
    data[o + Row.WEIGHT] = 0;
    unband(lane.records[p]);
  }
}
