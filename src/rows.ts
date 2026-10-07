import { Crowd, Flag, Hot, none } from './crowd.js';
import { KeyRows } from './keyrows.js';
import { type Laned, Per, Row } from './lane.js';
import type { Lanes } from './lanes.js';
import { reach } from './meet.js';
import { motionOf } from './motion.js';
import type { Motions } from './motions.js';
import { open } from './qualify.js';
import { settle } from './sample.js';
import type { Voice } from './voice.js';

/** Whether two crowds' channels are the same list. */
function same(a: readonly Laned[], b: readonly Laned[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Takes a crowd row off its subject, to be placed again if a probe meets it again. */
export function unplace<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, p: number): void {
  const slot = c.list[p] as number;
  if (c.idle && slot >= 0) reach(lanes, slot, -1);
  c.list[p] = -1;
  c.records[p] = undefined;
  c.deltas[p] = null;
  const f = p * c.stride + Hot.FLAGS;
  c.hot[f] = (c.hot[f] as number) & ~Flag.PLACED;
  const o = p * Row.STRIDE;
  c.data[o + Row.MSLOT] = -1;
  c.data[o + Row.SAMPLED] = -1;
  c.data[o + Row.MET] = 0;
}

/**
 * Whether every voice qualifying for a crowd has its row, and every row's voice either qualified
 * or is done, so the crowds stand as a rebuild would leave them, departed rows aside.
 */
export function sameCrowds<I, O>(lanes: Lanes<I, O>, members: readonly Voice<I, O>[]): boolean {
  let live = 0;
  for (const v of members) {
    if (!lanes.crowdOf.has(v.id)) return false;
    live++;
  }
  let rows = 0;
  for (const [id, c] of lanes.crowdOf) {
    const p = c.rowOf.get(id) as number;
    if ((c.voices[p] as Voice<I, O>).state !== 'done') rows++;
  }
  return rows === live;
}

/**
 * Rebuilds the crowds from the voices that belong in one, in voice order: a voice already in a
 * crowd keeps its row's numbers, a new one gets a row a probe will place, and a voice no longer in
 * one is handed back to the general path, as a lane's voice is when it leaves.
 */
export function regroup<I, O>(lanes: Lanes<I, O>, members: Voice<I, O>[]): void {
  const keep = new Set(members.map((v) => v.id));
  for (const c of lanes.crowds)
    for (let p = 0; p < c.size; p++) {
      const v = c.voices[p] as Voice<I, O>;
      if (!keep.has(v.id) || v.state === 'done') leaveCrowd(lanes, c, p);
    }
  const old = lanes.crowds;
  const was = new Map(lanes.crowdOf);
  lanes.crowds = [];
  lanes.crowdOf.clear();
  lanes.overlap = false;
  for (const v of members) {
    const from = was.get(v.id);
    join(lanes, v, from, from?.rowOf.get(v.id), old);
  }
  if (lanes.crowds.length === 0) {
    lanes.lawsByKey.clear();
    lanes.lastLaw = null;
  }
}

/**
 * Gives a voice the next row of its channel's crowd, made if there is none: a copy of the row it
 * had in `from` at `at`, or a new one. `old` holds the crowds being replaced, whose idle state a
 * new crowd on the same channel keeps. Rows stay in voice order only because voices join in it.
 */
export function join<I, O>(
  lanes: Lanes<I, O>,
  v: Voice<I, O>,
  from: Crowd<I, O> | undefined,
  at: number | undefined,
  old: readonly Crowd<I, O>[],
): void {
  const chans = v.slots.map((s) => lanes.bySlot[s] as Laned);
  let c = lanes.crowds.find((o) => same(o.chans, chans));
  if (c === undefined) {
    c = new Crowd<I, O>(chans, (chans[0] as Laned).axes);
    const names = chans.map((ch) => ch.name).join(' ');
    const was = old.find((o) => o.chans.map((ch) => ch.name).join(' ') === names);
    if (was !== undefined) c.idle = was.idle;
    for (const o of lanes.crowds)
      if (o.chans.some((ch) => chans.includes(ch))) lanes.overlap = true;
    lanes.crowds.push(c);
  }
  const p = c.size;
  c.reserve(p + 1);
  if (from !== undefined && at !== undefined) copyRow(from, at, c, p);
  else newRow(lanes, c, p, v);
  if (c.hot[p * c.stride + Hot.EPOCH] === 0 && v.state !== 'pending')
    c.hot[p * c.stride + Hot.EPOCH] = open(lanes, v);
  c.rowOf.set(v.id, p);
  lanes.crowdOf.set(v.id, c);
  v.laned = true;
}

/** A crowd row takes up its voice as it now stands: opened once it starts, its fields copied again. */
export function retouchRow<I, O>(
  lanes: Lanes<I, O>,
  c: Crowd<I, O>,
  p: number,
  v: Voice<I, O>,
): void {
  const h = p * c.stride;
  if (c.hot[h + Hot.EPOCH] === 0 && v.state !== 'pending') c.hot[h + Hot.EPOCH] = open(lanes, v);
  c.hot[h + Hot.FLAGS] = (c.hot[h + Hot.FLAGS] as number) | Flag.VOICE;
}

/**
 * Compacts every crowd a quarter or more empty rows: each fill walks every row, and at half a
 * crowd replacing a voice a frame carried as many empty rows as live ones.
 */
export function compactSparse<I, O>(lanes: Lanes<I, O>): void {
  for (const c of lanes.crowds) if (c.dead > 64 && c.dead * 4 >= c.size) compact(c);
}

/**
 * Slides a crowd's rows down over the empty ones its departed voices left, in order, so its rows
 * stay in voice order; a qualify did this by rebuilding every crowd, a dropped frame at 10k rows.
 */
function compact<I, O>(c: Crowd<I, O>): void {
  // The rows' stops are copied into a fresh pool, leaving the departed rows' behind.
  const keys = c.keys;
  c.keys = new KeyRows();
  let q = 0;
  for (let p = 0; p < c.size; p++) {
    const v = c.voices[p] as Voice<I, O>;
    if (c.rowOf.get(v.id) !== p) {
      c.odd?.delete(p);
      continue;
    }
    if (q !== p) {
      copyRow(c, p, c, q, keys);
      c.odd?.delete(p);
      c.rowOf.set(v.id, q);
    } else copyKeys(keys, c, q);
    q++;
  }
  c.list.length = q;
  c.voices.length = q;
  c.records.length = q;
  c.deltas.length = q;
  c.motions.length = q;
  c.eases.length = q;
  c.laws.length = q;
  c.dead = 0;
}

/** A crowd voice left: its row stays, empty, until the crowds are next rebuilt. */
export function bury<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, p: number): void {
  const v = c.voices[p] as Voice<I, O>;
  leaveCrowd(lanes, c, p);
  c.list[p] = -1;
  c.records[p] = undefined;
  c.deltas[p] = null;
  c.motions[p] = undefined;
  c.hot[p * c.stride + Hot.FLAGS] = 0;
  c.rowOf.delete(v.id);
  lanes.crowdOf.delete(v.id);
  c.dead++;
}

function copyRow<I, O>(
  from: Crowd<I, O>,
  p: number,
  to: Crowd<I, O>,
  q: number,
  keys = from.keys,
): void {
  from.fix(p);
  to.list[q] = from.list[p] as number;
  to.data.set(from.data.subarray(p * Row.STRIDE, (p + 1) * Row.STRIDE), q * Row.STRIDE);
  to.hot.set(from.hot.subarray(p * from.stride, (p + 1) * from.stride), q * to.stride);
  copyKeys(keys, to, q);
  if (((from.hot[p * from.stride + Hot.FLAGS] as number) & Flag.STALE) !== 0) to.stale = true;
  to.samples.set(from.samples.subarray(p * from.axes, (p + 1) * from.axes), q * to.axes);
  to.deltas[q] = from.deltas[p] ?? null;
  to.records[q] = from.records[p];
  to.voices[q] = from.voices[p] as Voice<I, O>;
  to.motions[q] = from.motions[p];
  to.eases[q] = from.eases[p];
  to.laws[q] = from.laws[p] as Float64Array;
  const odd = from.odd?.get(p);
  if (odd !== undefined) {
    to.odd ??= new Map();
    to.odd.set(q, odd);
  }
}

/** Copies row `q`'s stops, as its `hot` holds their place in `keys`, into its crowd's pool. */
function copyKeys<I, O>(keys: KeyRows, c: Crowd<I, O>, q: number): void {
  const h = q * c.stride;
  if (((c.hot[h + Hot.FLAGS] as number) & Flag.FLAT) !== 0)
    c.hot[h + Hot.AT] = c.keys.copy(keys, c.hot[h + Hot.AT] as number);
}

function newRow<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, p: number, v: Voice<I, O>): void {
  const run = motionOf<I>(v.patch);
  const h = p * c.stride;
  c.hot.fill(0, h, h + c.stride);
  const at = v.built === null ? -1 : c.keys.add(v.built, c.chans);
  if (at >= 0) {
    c.hot[h + Hot.AT] = at;
    c.hot[h + Hot.X0] = v.duration;
    c.hot[h + Hot.MS] = v.passes;
  }
  c.restale(
    p,
    Flag.VOICE |
      (run === undefined ? 0 : Flag.MOTION) |
      (run?.ease === undefined ? 0 : Flag.TWEEN) |
      (at >= 0 ? Flag.FLAT : 0),
  );
  c.hot[h + Hot.ID] = v.id;
  c.list[p] = -1;
  const o = p * Row.STRIDE;
  c.data.fill(0, o, o + Row.STRIDE);
  c.data[o + Row.MSLOT] = -1;
  c.data[o + Row.SAMPLED] = -1;
  c.deltas[p] = null;
  c.records[p] = undefined;
  c.voices[p] = v;
  c.motions[p] = run;
  if (run === undefined) {
    c.laws[p] = none;
    c.eases[p] = undefined;
    return;
  }
  c.laws[p] = lawOf(lanes, run);
  c.eases[p] = run.ease;
  // A lane sharing the patch keeps no samples while it watches it: have it keep them first.
  const watching = run.watcher === lanes ? lanes.byId.get(run.watchId) : undefined;
  if (watching !== undefined) for (let q = 0; q < watching.list.length; q++) watching.fix(q);
  run.watcher = lanes;
  run.watchId = v.id;
}

/** A patch's law, as the one array every crowd row with the same law shares. */
function lawOf<I, O>(lanes: Lanes<I, O>, run: Motions<I>): Float64Array {
  // Most crowds' voices share one law, so the last one found is checked before any key is made.
  const last = lanes.lastLaw;
  if (last !== null && run.hasLaw(last)) return last;
  const law = lawKeyed(lanes, run);
  lanes.lastLaw = law;
  return law;
}

function lawKeyed<I, O>(lanes: Lanes<I, O>, run: Motions<I>): Float64Array {
  const law = run.law();
  const key = law.join(' ');
  const known = lanes.lawsByKey.get(key);
  if (known !== undefined) return known;
  lanes.lawsByKey.set(key, law);
  return law;
}

/** Hands a crowd voice back to the general path, as `leave` does a lane's. */
function leaveCrowd<I, O>(lanes: Lanes<I, O>, c: Crowd<I, O>, p: number): void {
  const slot = c.list[p] as number;
  const rec = c.records[p];
  if (slot >= 0) {
    if (c.idle) reach(lanes, slot, -1);
    const w = reportedRow(lanes, c, p, slot);
    if (rec !== undefined && w !== undefined) rec.weight = w;
    if (rec !== undefined && c.motions[p] !== undefined) settle(lanes, c, p, slot, rec);
  }
  const run = c.motions[p];
  const v = c.voices[p] as Voice<I, O>;
  if (run !== undefined && run.watcher === lanes && run.watchId === v.id) run.watcher = null;
  v.laned = false;
}

/** A crowd row's weight as `reported` reads a lane position's. */
export function reportedRow<I, O>(
  lanes: Lanes<I, O>,
  c: Crowd<I, O>,
  p: number,
  slot: number,
): number | undefined {
  const o = slot * Per.SLOT;
  if (!((lanes.per[o + Per.LANE_PROBE] as number) > (lanes.per[o + Per.GENERAL_PROBE] as number)))
    return undefined;
  if ((c.list[p] as number) !== slot) return undefined;
  return c.data[
    p * Row.STRIDE + (lanes.per[o + Per.LANE_FILL] === lanes.fills ? Row.WEIGHT : Row.PROBED)
  ];
}
