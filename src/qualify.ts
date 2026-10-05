import { type Numeric, numericOf } from './channels.js';
import { flush } from './columns.js';
import { crowdable } from './crowd.js';
import { wake } from './fill.js';
import { Lane, type Laned, type Locus, Per } from './lane.js';
import type { Lanes } from './lanes.js';
import { bury, compactSparse, join, regroup, retouchRow, sameCrowds } from './rows.js';
import { settle } from './sample.js';
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
    if (lane.epoch === 0 && v.state !== 'pending') lane.epoch = open(lanes, v);
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
      };
      loci.set(name, g);
      lanes.loci.push(g);
    }
    g.members.push(lane);
    lane.group = g;
  }
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
  lanes.bySlot = host.channels.map(() => undefined);
  channels.forEach((on, slot) => {
    if (!on) return;
    const channel = host.channels[slot] as Channel<unknown>;
    const n = numericOf(channel) as Numeric;
    const rest = channel.rest as number | number[];
    const ch: Laned = {
      name: host.names[slot] as string,
      op: n.op,
      scalar: typeof rest === 'number',
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
  for (const subject of v.named) {
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
  const touched = [...new Set(lanes.touched)].sort((a, b) => a.id - b.id);
  lanes.touched.length = 0;
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
    if (!laned && !fits) {
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

/**
 * A new voice that fits and writes only laned channels, and that no crowd takes, gets a lane at
 * the end of the order, its id being past every other: what a qualify would give it, since such a
 * voice joining cannot unlane a channel.
 */
function enlane<I, O>(lanes: Lanes<I, O>, v: Voice<I, O>): void {
  const lane = new Lane<I, O>(v);
  v.laned = true;
  if (v.state !== 'pending') lane.epoch = open(lanes, v);
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
      lane.epoch = open(lanes, v);
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
      if (rec !== undefined && w !== undefined) rec.weight = w;
      if (rec !== undefined && lane.motion !== undefined) settle(lanes, lane, p, slot, rec);
    }
  const run = lane.motion;
  if (run !== undefined && run.watcher === lanes && run.watchId === lane.voice.id) {
    for (let p = 0; p < lane.list.length; p++) lane.fix(p);
    run.watcher = null;
  }
  lane.voice.laned = false;
}
