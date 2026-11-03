import { axesOf } from './channels.js';
import { copy } from './clone.js';
import type { Values } from './fold.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Subject } from './subject.js';
import type { Channel, Columns } from './types.js';

/** What `pull` remembers at a position it has read no subject at. */
const UNREAD: unknown = Symbol('unread');

/** One channel `pull` writes: where in the kit, how many numbers a subject, and its rest. */
export interface Column {
  key: string;
  slot: number;
  axes: number;
  out: Float64Array;
  /** The rest, clamped, or NaN for a channel with none. */
  rest: Float64Array;
  bounds: readonly [number, number] | undefined;
}

export function clampRun(
  out: Float64Array,
  at: number,
  n: number,
  [lo, hi]: readonly [number, number],
): void {
  for (let i = at; i < at + n; i++) {
    const x = out[i] as number;
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
}

/** Writes a folded pose's value into subject `n`'s places in a column. */
function writeValue(c: Column, v: unknown, n: number): void {
  const at = n * c.axes;
  if (typeof v === 'number' && c.axes === 1) c.out[at] = v;
  else if (Array.isArray(v) && v.length === c.axes)
    for (let a = 0; a < c.axes; a++) c.out[at + a] = v[a] as number;
  else if (v === undefined) c.out.fill(Number.NaN, at, at + c.axes);
  else
    throw new TypeError(
      `blits: pull reads ${c.key} as ${c.axes === 1 ? 'a number' : `${c.axes} numbers`} a subject, and the pose has ${String(v)}`,
    );
}

/** After a probe, keeps the pose a retarget from `'current'` reads as the subject's last. */
export function keep<I, O>(this: Mixer<I, O>, subject: I, pose: O, out: O | undefined): void {
  // A pose handed back without `out` is the host's to edit, so it is copied too. A host sampling
  // into its own object only pays for the copy once something has asked to retarget from it.
  let kept: O | undefined;
  if (out === undefined || this.wantsPose) {
    kept = {} as O;
    for (const key of this.names) {
      const v = (pose as Record<string, unknown>)[key];
      if (v !== undefined) (kept as Record<string, unknown>)[key] = copy(v);
    }
  }
  if (kept !== undefined) {
    const rec = this.lastPoses.get(subject);
    if (rec === undefined)
      this.lastPoses.set(subject, {
        pose: kept,
        at: this.now,
        prev: undefined,
        prevAt: Number.NaN,
      });
    else if (rec.at === this.now) rec.pose = kept;
    else {
      rec.prev = rec.pose;
      rec.prevAt = rec.at;
      rec.pose = kept;
      rec.at = this.now;
    }
  }
}

export function pull<I, O>(mix: Mixer<I, O>, subjects: Iterable<I>, into: Columns<O>): void {
  const columns = columnsOf(mix, into);
  const lanes = mix.lanes;
  const now = mix.now;
  if (mix.scratch === undefined) mix.scratch = mix.pose();
  let room = Number.POSITIVE_INFINITY;
  let tightest = '';
  for (const c of columns) {
    const fits = Math.floor(c.out.length / c.axes);
    if (fits < room) {
      room = fits;
      tightest = c.key;
    }
  }
  // Any other iterable is read into an array first, no further than one past the room there is.
  let list: readonly I[];
  if (Array.isArray(subjects)) list = subjects as readonly I[];
  else {
    const taken: I[] = [];
    for (const subject of subjects) if (taken.push(subject) > room) break;
    list = taken;
  }
  if (list.length > room)
    throw new RangeError(
      `blits: pull's array for ${tightest} has room for ${room} subjects, and was given more`,
    );
  const whole = lanes !== null && !mix.wantsPose;
  // An array read again in the same order reuses each position's chain head while it is current:
  // all of them at once while nothing has relinked since the last pull, else one by one.
  const was = mix.pulled;
  const heads = mix.pulledHeads;
  if (mix.pulledSlots.length < list.length) {
    const slots = new Int32Array(Math.max(64, list.length)).fill(-1);
    slots.set(mix.pulledSlots);
    mix.pulledSlots = slots;
  }
  // A position the list no longer has, or has anew, holds no head: its slot says so.
  if (list.length < was.length) mix.pulledSlots.fill(-1, list.length, was.length);
  // A new position holds a mark no subject equals: a hole would read as `undefined`, a subject.
  for (let n = was.length; n < list.length; n++) was.push(UNREAD as I);
  was.length = list.length;
  heads.length = list.length;
  const version = mix.version;
  const relinks = mix.relinks;
  const live = !Number.isNaN(now);
  const current = live && mix.pulledVersion === version && mix.pulledRelinks === relinks;
  // Which remembered heads `pullRun` takes as current: all while nothing has changed; those
  // `unlink` has not stamped since `pulledRelinks` while the version they were linked at stands;
  // none otherwise.
  const since = current
    ? Number.POSITIVE_INFINITY
    : live && mix.pulledVersion === version
      ? mix.pulledRelinks
      : -1;
  try {
    readAll(mix, list, columns, live, current, since, whole);
  } finally {
    if (lanes !== null) lanes.pulls.flush(lanes);
  }
  // Every head is current only if nothing relinked or changed version while they were read.
  const unchanged = live && mix.version === version && mix.relinks === relinks;
  mix.pulledVersion = unchanged ? version : Number.NaN;
  mix.pulledRelinks = relinks;
}

/**
 * Reads every subject in `list` into the columns, kept apart from `pull` so a list long enough to
 * compile the loop on the stack does not leave `pull`'s own code compiled before its tail had run:
 * under churn that code deoptimized at the tail on every frame.
 */
function readAll<I, O>(
  mix: Mixer<I, O>,
  list: readonly I[],
  columns: readonly Column[],
  live: boolean,
  current: boolean,
  since: number,
  whole: boolean,
): void {
  const lanes = mix.lanes;
  const now = mix.now;
  const scratch = mix.scratch as O;
  const was = mix.pulled;
  const heads = mix.pulledHeads;
  const slots = mix.pulledSlots;
  const version = mix.version;
  // Every subject read from the lanes, at the positions it had last time, goes in one run.
  const runs = live && whole;
  for (let n = 0; n < list.length; n++) {
    if (runs) {
      n = (lanes as Lanes<I, O>).pulls.pullRun(
        lanes as Lanes<I, O>,
        slots,
        list,
        was,
        since,
        n,
        columns,
        now,
        mix.version,
      );
      if (n === list.length) break;
    }
    const subject = list[n] as I;
    let slot = -1;
    if (live) {
      if (current && was[n] === subject) slot = slots[n] as number;
      else {
        const kept = heads[n];
        const head =
          was[n] === subject && kept !== undefined && kept.version === version
            ? kept
            : mix.chain(subject);
        was[n] = subject;
        heads[n] = head;
        slot = head.slot;
        // Numbered out of the list's order, as swap-remove leaves a subject: renumbered into it.
        const to = n === 0 ? 0 : (slots[n - 1] as number) + 1;
        if (runs && slot >= 0 && slot !== to && to >= 0) {
          if ((lanes as Lanes<I, O>).pulls.renumber(mix, subject, head, to)) {
            for (let j = was.indexOf(subject); j >= 0; j = was.indexOf(subject, j + 1))
              slots[j] = to;
            slot = to;
          }
        }
        slots[n] = slot;
      }
    }
    const laned = live && lanes?.prepare(slot, subject, mix.version, heads[n] ?? null) === true;
    if (laned && whole && (lanes as Lanes<I, O>).whole && !(lanes as Lanes<I, O>).owes(slot)) {
      (lanes as Lanes<I, O>).pulls.writeLater(lanes as Lanes<I, O>, slot, columns, n, slots);
      continue;
    }
    const head = live ? (heads[n] as Subject<unknown>) : null;
    const folded = mix.foldWith(subject, scratch, head, laned, false);
    const pose = (mix.bounded.length === 0 ? folded : mix.clamp(folded as Values)) as Values;
    mix.keep(subject, pose as O, scratch);
    for (const c of columns) writeValue(c, pose[c.key], n);
  }
}

/**
 * The kit slot, width, rest and bounds of every channel `pull` was handed an array for: one record
 * a channel for the mix's life, pointed at the array this call was handed.
 */
function columnsOf<I, O>(mix: Mixer<I, O>, into: Columns<O>): Column[] {
  const columns: Column[] = [];
  mix.pullColumns ??= new Map();
  const known = mix.pullColumns;
  for (const key of Object.keys(into)) {
    const out = (into as Record<string, Float64Array | undefined>)[key];
    if (out === undefined) continue;
    const had = known.get(key);
    if (had !== undefined) {
      had.out = out;
      columns.push(had);
      continue;
    }
    const slot = mix.slotOf.get(key);
    if (slot === undefined) throw new Error(`blits: pull was handed ${key}, which the kit lacks`);
    const channel = mix.channels[slot] as Channel<unknown>;
    const rest = channel.rest;
    const axes = axesOf(channel);
    const bounds = channel.bounds as readonly [number, number] | undefined;
    const at = new Float64Array(axes).fill(Number.NaN);
    if (typeof rest === 'number') at[0] = rest;
    else if (Array.isArray(rest)) at.set(rest as number[]);
    if (bounds !== undefined) clampRun(at, 0, axes, bounds);
    const column = { key, slot, axes, out, rest: at, bounds };
    known.set(key, column);
    columns.push(column);
  }
  return columns;
}

/** Forgets the array `pull` last read, whose heads a seek has made stale. */
export function unpull<I, O>(mix: Mixer<I, O>): void {
  mix.pulled = [];
  mix.pulledHeads = [];
  mix.pulledSlots = new Int32Array(0);
  mix.pulledVersion = Number.NaN;
  mix.pulledRelinks = -1;
}
