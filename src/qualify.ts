import { type Numeric, numericOf } from './channels.js';
import { flush } from './columns.js';
import { crowdable } from './crowd.js';
import { byId } from './due.js';
import { weighAt } from './everyone.js';
import { wake } from './fill.js';
import { Lane, type Laned, type Locus, Per } from './lane.js';
import type { Lanes } from './lanes.js';
import { reach } from './meet.js';
import { bury, compactSparse, join, regroup, retouchRow, sameCrowds } from './rows.js';
import { settle } from './sample.js';
import type { Subject } from './subject.js';
import type { Channel } from './types.js';
import type { Voice } from './voice.js';

/** What qualifying needs of one voice: whether its patch and spec can run on a lane, and its channels. */
export interface Candidate {
  readonly id: number;
  readonly fits: boolean;
  readonly slots: readonly number[];
}

/**
 * Which channels run as lanes and which voices run on them: the fixed point where every voice
 * writing a laned channel fits and writes only laned channels. Only channels some laned voice
 * writes are laned.
 */
export function qualify(
  numeric: readonly boolean[],
  voices: readonly Candidate[],
): { channels: boolean[]; voices: Set<number> } {
  const open = numeric.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of voices) {
      if (v.fits && v.slots.every((s) => open[s])) continue;
      for (const s of v.slots)
        if (open[s]) {
          open[s] = false;
          changed = true;
        }
    }
  }
  const laned = new Set<number>();
  const channels = numeric.map(() => false);
  for (const v of voices) {
    if (!v.fits || !v.slots.every((s) => open[s])) continue;
    laned.add(v.id);
    for (const s of v.slots) channels[s] = true;
  }
  return { channels, voices: laned };
}

export function requalify<I, O>(lanes: Lanes<I, O>, version: number): void {
  flush(lanes);
  const host = lanes.host;
  lanes.qualifiedVersion = version;
  lanes.filledVersion = Number.NaN;
  const touched = lanes.touched.slice();
  lanes.touched.length = 0;
  // An owner writes nothing and no fold meets it, so it neither takes a lane nor keeps one whole.
  const present = host.voices.filter((v) => v.state !== 'done' && v.holding === null);
  for (const v of present) if (v.id > lanes.known) lanes.known = v.id;
  const numeric = host.channels.map((c) => numericOf(c) !== undefined);
  // A voice writing nothing has no lane to fill, so it stays where its calls are made.
  const fits = present.map((v) => v.slots.length > 0 && host.fits(v));
  if (callsOff) keepCallsOff(present, fits, host.channels);
  const candidates = () =>
    present.map((v, i) => ({ id: v.id, fits: fits[i] as boolean, slots: v.slots }));
  let { channels, voices } = qualify(numeric, candidates());
  // A locus folds its members together, so they run on lanes all together or not at all.
  for (let split = true; split; ) {
    split = false;
    const loci = new Map<string, number[]>();
    present.forEach((v, i) => {
      const name = v.spec.locus;
      if (name === undefined) return;
      const at = loci.get(name);
      if (at === undefined) loci.set(name, [i]);
      else at.push(i);
    });
    for (const at of loci.values()) {
      const on = at.filter((i) => voices.has((present[i] as Voice<I, O>).id)).length;
      if (on === 0 || on === at.length) continue;
      for (const i of at) fits[i] = false;
      split = true;
    }
    if (split) ({ channels, voices } = qualify(numeric, candidates()));
  }
  for (const lane of lanes.lanes) if (!voices.has(lane.voice.id)) leave(lanes, lane);
  const kept: Lane<I, O>[] = [];
  let crowded = 0;
  for (const v of present) {
    if (!voices.has(v.id)) continue;
    if (crowdable(v)) {
      crowded++;
      continue;
    }
    const lane = lanes.byId.get(v.id) ?? new Lane<I, O>(v);
    v.laned = true;
    if (lane.epoch === 0 && v.state !== 'pending') opened(lanes, lane);
    kept.push(lane);
  }
  lanes.lanes = kept;
  lanes.loci = [];
  const loci = new Map<string, Locus<I, O>>();
  for (const lane of kept) {
    lane.group = null;
    const name = lane.voice.spec.locus;
    if (name === undefined) continue;
    let g = loci.get(name);
    if (g === undefined) {
      g = {
        members: [],
        met: new Float64Array(lanes.cap),
        first: new Float64Array(lanes.cap),
        sum: new Float64Array(lanes.cap),
        values: [],
        taken: [],
        contiguous: false,
        inline: false,
      };
      loci.set(name, g);
      lanes.loci.push(g);
    }
    g.members.push(lane);
    lane.group = g;
  }
  for (const [name, g] of loci) g.contiguous = contiguous(present, voices, name, g.members);
  lanes.dense = kept
    .filter((l) => l.voice.named === null && l.epoch > 0)
    .sort((a, b) => a.epoch - b.epoch);
  lanes.whole = kept.length + crowded === present.length;
  lanes.byId.clear();
  for (const lane of kept) lanes.byId.set(lane.voice.id, lane);
  // With no lane left no fill comes to let go of the subjects the last probes held.
  if (kept.length === 0 && crowded === 0) lanes.subjects = [];
  const members = present.filter((v) => voices.has(v.id) && crowdable(v));
  // The same channels laned and the same voices crowded, as when a voice over every subject comes
  // or goes among a crowd of thousands: what a rebuild would make is what is there.
  if (sameChannels(lanes, channels) && sameCrowds(lanes, members)) {
    for (const lane of kept) {
      lane.chans = lane.voice.slots.map((s) => lanes.bySlot[s] as Laned);
      lane.values = lane.chans.map(() => undefined);
    }
    for (const c of lanes.crowds)
      for (let p = 0; p < c.size; p++) {
        const v = c.voices[p] as Voice<I, O>;
        if (c.rowOf.get(v.id) === p && v.state === 'done') bury(lanes, c, p);
      }
    // A crowd voice that started or began fading takes it up on its row, as `retouch` does.
    for (const v of touched) {
      if (v.state === 'done') continue;
      const c = lanes.crowdOf.get(v.id);
      const p = c?.rowOf.get(v.id);
      if (c !== undefined && p !== undefined) retouchRow(lanes, c, p, v);
    }
    compactSparse(lanes);
    return;
  }
  lanes.laned = [];
  lanes.copier = null;
  lanes.bySlot = host.channels.map(() => undefined);
  channels.forEach((on, slot) => {
    if (!on) return;
    const channel = host.channels[slot] as Channel<unknown>;
    const n = numericOf(channel) as Numeric;
    // A rest-less channel's values are NaN until some voice passes the band: absent from the pose.
    const rest = (channel.rest ?? Number.NaN) as number | number[];
    const scalar = typeof rest === 'number' && n.axes === 1;
    const op = n.folds ?? n.op;
    const ch: Laned = {
      name: host.names[slot] as string,
      op,
      plain: op !== 'last' && op !== 'own' && n.turn === undefined,
      straight: n.folds === undefined,
      turn: n.turn ?? 0,
      channel,
      scalar,
      rest: typeof rest === 'number' ? rest : (rest[0] as number),
      axes: n.axes,
      values: new Float64Array(lanes.cap * n.axes),
      start: typeof rest === 'number' ? [] : rest,
      index: lanes.laned.length,
    };
    lanes.laned.push(ch);
    lanes.bySlot[slot] = ch;
  });
  lanes.copies.length = 0;
  for (const ch of lanes.bySlot) lanes.copies.push(ch !== undefined);
  for (const lane of kept) {
    lane.chans = lane.voice.slots.map((s) => lanes.bySlot[s] as Laned);
    lane.values = lane.chans.map(() => undefined);
  }
  regroup(lanes, members);
}

/** Whether `keepCallsOff` applies; settable for bench/frame.mjs. */
export let callsOff = true;

export function setCallsOff(on: boolean): void {
  callsOff = on;
}

/**
 * A voice whose patch a lane would call, as a fn voice's (no tween, keys or motion), writing only
 * arrays: a crowd writing a number reads 17% to 25% faster on lanes (bench/frame.mjs `named` under
 * CALLS_OFF, msb-uai, 2026-10-21).
 */
export function calls<I, O>(v: Voice<I, O>, channels: readonly Channel<unknown>[]): boolean {
  return (
    v.built === null &&
    v.motion === undefined &&
    v.slots.every((s) => vector(channels[s] as Channel<unknown>))
  );
}

/** A channel folding arrays with a rest, not `last`: what the rule was timed on. */
function vector(channel: Channel<unknown>): boolean {
  return Array.isArray(channel.rest) && numericOf(channel)?.op !== 'last';
}

/**
 * Leaves off lanes each voice calling its patch where no other fitting voice writes any of its
 * channels, but a crowd's other voices: a lane calls such a patch once a subject as the general
 * path does, and its fill walks the subjects a second time (bench/frame.mjs `fns`, 2.58 ms a frame
 * on lanes against 1.07 off, studio, 2026-10-21). Two voices over many subjects on one channel
 * fold faster on lanes (`tweenfn` with three voices).
 */
function keepCallsOff<I, O>(
  present: readonly Voice<I, O>[],
  fits: boolean[],
  channels: readonly Channel<unknown>[],
): void {
  const others = new Array<boolean>(channels.length).fill(false);
  const wide = new Array<boolean>(channels.length).fill(false);
  present.forEach((v, i) => {
    if (!fits[i]) return;
    const crowd = crowdable(v);
    if (!calls(v, channels)) for (const s of v.slots) others[s] = true;
    else if (!crowd)
      for (const s of v.slots) {
        if (wide[s]) others[s] = true;
        wide[s] = true;
      }
  });
  present.forEach((v, i) => {
    if (fits[i] && calls(v, channels) && !v.slots.some((s) => others[s])) fits[i] = false;
  });
}

/** Whether qualifying laned exactly the channels laned now. */
function sameChannels<I, O>(lanes: Lanes<I, O>, channels: readonly boolean[]): boolean {
  const by = lanes.bySlot;
  if (by.length !== channels.length) return false;
  for (let i = 0; i < by.length; i++) if ((by[i] !== undefined) !== channels[i]) return false;
  return true;
}

/**
 * A voice starts playing on a lane or crowd: its epoch. Every subject meets a voice over all of
 * them on its next probe; a voice naming its subjects marks only those.
 */
export function open<I, O>(lanes: Lanes<I, O>, v: Voice<I, O>): number {
  const epoch = ++lanes.epochs;
  if (v.named === null) {
    lanes.wide = epoch;
    return epoch;
  }
  for (const subject of v.named.list) {
    const slot = lanes.host.slotOf(subject);
    if (slot < 0 || slot >= lanes.cap) continue;
    const i = slot * Per.SLOT + Per.SEEN;
    const seen = lanes.per[i] as number;
    const from = seen < 0 ? -1 - seen : seen;
    lanes.per[i] = -1 - Math.min(from, epoch - 1);
  }
  return epoch;
}

/**
 * Takes the voices `touch` named on or off their crowds, each as it now stands; false at the
 * first that cannot be, which needs a qualify: one that leaves a lane or the general path, which
 * may open a channel, or one that joins anything but a crowd on a laned channel. Neither a voice
 * that fits joining laned channels nor a laned one leaving moves the fixed point `qualify` finds.
 * A crowd a quarter empty rows is compacted.
 */
export function retouch<I, O>(lanes: Lanes<I, O>): boolean {
  const touched = byId(lanes.touched);
  lanes.touched = [];
  let kept = 0;
  for (let i = 0; i < touched.length; i++)
    if (i === 0 || touched[i] !== touched[i - 1]) touched[kept++] = touched[i] as Voice<I, O>;
  touched.length = kept;
  // The qualify a false answer calls takes up every touched voice, crowd rows starting included.
  const qualify = (): false => {
    lanes.touched = touched;
    return false;
  };
  for (const v of touched) {
    const known = v.id <= lanes.known;
    if (v.id > lanes.known) lanes.known = v.id;
    const c = lanes.crowdOf.get(v.id);
    const p = c?.rowOf.get(v.id);
    if (c !== undefined && p !== undefined) {
      if (v.state === 'done') {
        bury(lanes, c, p);
        continue;
      }
      retouchRow(lanes, c, p, v);
      continue;
    }
    if (v.state === 'done' && !known) continue;
    const lane = lanes.byId.get(v.id);
    if (lane !== undefined) {
      if (!relane(lanes, lane)) return qualify();
      continue;
    }
    if (v.state === 'done') return qualify();
    // A locus's members are on lanes together or not at all, so one joining may move the others.
    if (v.spec.locus !== undefined) return qualify();
    const laned = v.slots.some((slot) => lanes.bySlot[slot] !== undefined);
    const fits = v.slots.length > 0 && lanes.host.fits(v);
    // As `keepCallsOff`: with none of its channels laned, no fitting voice but its like writes them.
    if (!laned && (!fits || (callsOff && crowdable(v) && calls(v, lanes.host.channels)))) {
      lanes.whole = false;
      continue;
    }
    if (known || !fits || !laned || v.slots.some((slot) => lanes.bySlot[slot] === undefined))
      return qualify();
    if (crowdable(v)) join(lanes, v, undefined, undefined, lanes.crowds);
    else enlane(lanes, v);
  }
  compactSparse(lanes);
  // As a qualify leaving nothing on lanes: no fill comes to let go of what the last probes held.
  if (lanes.lanes.length === 0 && lanes.crowds.every((c) => c.dead === c.size)) lanes.subjects = [];
  return true;
}

/** A lane's voice started playing: its epoch, and room up front where it reaches every subject. */
function opened<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): void {
  const v = lane.voice;
  lane.epoch = open(lanes, v);
  if (v.named === null && v.spec.target === undefined) {
    lane.reserve(lanes.live, lanes.cap);
    if (placesAll(lanes, lane)) placeAll(lanes, lane);
  }
}

/**
 * Whether a lane just opened can take every numbered subject now, its first call or read for each
 * made by the fill: a stateless fn or keys voice sharing one record, which every subject would meet
 * at its next probe, in a host that probed every subject last frame. One by one, each probe would
 * meet it and make its first call or read there (`foldNow` in `meet.ts`).
 */
function placesAll<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): boolean {
  const v = lane.voice;
  return (
    v.sharing &&
    v.everyone !== null &&
    lane.motion === undefined &&
    !v.keeping &&
    typeof v.spec.weight !== 'function' &&
    lane.list.length === 0 &&
    lanes.lastDistinct >= lanes.live
  );
}

/** Gives every numbered subject a position on a lane `placesAll` passed. */
function placeAll<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): void {
  const rec = lane.voice.everyone as Subject<unknown>;
  const numbers = lanes.numbers;
  const size = Math.min(numbers.size, lanes.cap);
  for (let slot = 0; slot < size; slot++) {
    if (!numbers.has(slot)) continue;
    lane.add(slot, rec);
    if (lane.idle) reach(lanes, slot, 1);
  }
  lane.every = true;
}

/**
 * A new voice that fits and writes only laned channels, and that no crowd takes, gets a lane at
 * the end of the order, its id being past every other: what a qualify would give it, since such a
 * voice joining cannot unlane a channel.
 */
function enlane<I, O>(lanes: Lanes<I, O>, v: Voice<I, O>): void {
  const lane = new Lane<I, O>(v);
  v.laned = true;
  if (v.state !== 'pending') opened(lanes, lane);
  lane.chans = v.slots.map((s) => lanes.bySlot[s] as Laned);
  lane.values = lane.chans.map(() => undefined);
  lanes.lanes.push(lane);
  lanes.byId.set(v.id, lane);
  if (v.named === null && lane.epoch > 0) lanes.dense.push(lane);
}

/**
 * A laned voice that started playing or finished, as a qualify would take it: a lane leaving
 * cannot lane or unlane another channel. False for a locus member, which a qualify must take.
 */
function relane<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): boolean {
  const v = lane.voice;
  if (v.state !== 'done') {
    if (lane.epoch === 0 && v.state !== 'pending') {
      opened(lanes, lane);
      if (v.named === null) lanes.dense.push(lane);
    }
    return true;
  }
  if (lane.group !== null) return false;
  leave(lanes, lane);
  lanes.lanes.splice(lanes.lanes.indexOf(lane), 1);
  const d = lanes.dense.indexOf(lane);
  if (d >= 0) lanes.dense.splice(d, 1);
  lanes.byId.delete(v.id);
  return true;
}

/** Hands a voice back to the general path, with the weights `weightOf` reports kept on its records. */
function leave<I, O>(lanes: Lanes<I, O>, lane: Lane<I, O>): void {
  if (lane.idle) wake(lanes, lane);
  // A retired voice reports no weight, so only a motion's samples are left to settle.
  const done = lane.voice.state === 'done';
  if (!done || lane.motion !== undefined)
    for (let p = 0; p < lane.list.length; p++) {
      const rec = lane.records[p];
      const slot = lane.list[p] as number;
      const w = done ? undefined : lanes.reported(lane, slot);
      if (rec !== undefined && w !== undefined) {
        if (lane.voice.sharing) weighAt(lane.voice, slot, w, lanes.cap);
        else rec.weight = w;
      }
      if (rec !== undefined && lane.motion !== undefined) settle(lanes, lane, p, slot, rec);
    }
  const run = lane.motion;
  if (run !== undefined && run.watcher === lanes && run.watchId === lane.voice.id) {
    for (let p = 0; p < lane.list.length; p++) lane.fix(p);
    run.watcher = null;
  }
  lane.voice.laned = false;
}

/**
 * Whether a locus's members, in the order lanes run, have no laned or crowded voice of another
 * locus or none between them, so its every subject folds at its first member's turn.
 */
function contiguous<I, O>(
  present: readonly Voice<I, O>[],
  voices: ReadonlySet<number>,
  name: string,
  members: readonly Lane<I, O>[],
): boolean {
  for (let i = 1; i < members.length; i++)
    if ((members[i] as Lane<I, O>).voice.id <= (members[i - 1] as Lane<I, O>).voice.id)
      return false;
  const lo = (members[0] as Lane<I, O>).voice.id;
  const hi = (members[members.length - 1] as Lane<I, O>).voice.id;
  for (const v of present)
    if (v.id > lo && v.id < hi && voices.has(v.id) && v.spec.locus !== name) return false;
  return true;
}
