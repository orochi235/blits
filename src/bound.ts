import { unband } from './fold.js';
import { VoiceHandle } from './handle.js';
import { keepProbed, type Lane, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import { Places } from './places.js';

/**
 * Internal, unreleased: a voice's signal declared 0 beyond a circle around a point the host moves,
 * over positions the host gives the mix. Outside it the voice is not read at all, which is what
 * lets a lane fill visit only the subjects within it. Its public shape is undecided (HANDOFF item 4).
 */

/** The circle a bound reads once a frame, which the host moves by writing to it. */
export interface Area {
  x: number;
  y: number;
  r: number;
}

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
  /** Whether `lit` has been seeded with every position the lane held before the bound. */
  seeded = false;

  constructor(
    readonly mix: Mixer<I, O>,
    readonly area: Area,
  ) {}
}

/** Gives the mix its subjects' positions, `x` then `y` side by side in `xy`, read in place. */
export function place<I, O>(
  mix: Mixer<I, O>,
  subjects: readonly I[],
  xy: Float64Array,
  cell: number,
): void {
  mix.places ??= new Places<I>();
  mix.places.set(subjects, xy, cell);
  moved(mix);
}

/** The host wrote new positions into the `xy` it gave `place`. */
export function moved<I, O>(mix: Mixer<I, O>): void {
  if (mix.places !== null) mix.places.dirty = true;
  mix.lanes?.refill();
}

/**
 * Bounds a voice's signal to `area`. Refused on a mix without positions, and on any voice whose
 * reads a skipped subject could not leave as they were: one with state, a locus, history, an
 * owner, a blend, `from: 'current'`, or subjects of its own.
 */
export function bound<I, O>(mix: Mixer<I, O>, handle: VoiceHandle<I, O>, area: Area): void {
  const voice = VoiceHandle.voiceOf(handle);
  if (voice === null) throw new Error('blits: bound: no voice behind the handle');
  if (mix.places === null) throw new Error('blits: bound: the mix has no positions');
  const spec = voice.spec;
  const patch = voice.patch;
  if (typeof spec.weight !== 'function') throw new Error('blits: bound: the voice has no signal');
  if (
    mix.opts.history !== undefined ||
    voice.named !== null ||
    spec.locus !== undefined ||
    spec.from === 'current' ||
    voice.blend !== null ||
    voice.owner !== null ||
    voice.holding !== null ||
    voice.motion !== undefined ||
    patch.state !== undefined ||
    patch.step !== undefined
  )
    throw new Error('blits: bound: not on this voice');
  voice.bound = new Bound(mix, area);
  mix.lanes?.refill();
  mix.stir();
}

function snap<I, O>(b: Bound<I, O>, mix: Mixer<I, O>): void {
  if (b.frame === mix.frame) return;
  b.frame = mix.frame;
  const a = b.area;
  b.x = a.x;
  b.y = a.y;
  b.r = a.r;
  b.r2 = a.r * a.r;
}

/** Whether `subject` is within the voice's bound, on the general path. */
export function within<I, O>(mix: Mixer<I, O>, b: Bound<I, O>, subject: I): boolean {
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
  if (!b.seeded) {
    b.seeded = true;
    for (const slot of lane.list) old.push(slot);
  }
  const voice = lane.voice;
  const host = lanes.host;
  const inAt = b.inAt;
  const n = places.query(b.x, b.y, b.r, b.r2);
  const found = places.found;
  const list = places.list;
  for (let k = 0; k < n; k++) {
    const slot = host.slotOf(list[found[k] as number] as I);
    if (slot < 0 || inAt[slot] === fills) continue;
    inAt[slot] = fills;
    const p = lane.positionOf(slot);
    if (p < 0) continue;
    lit(b, slot, fills);
    lanes.one(lane, p, slot);
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
