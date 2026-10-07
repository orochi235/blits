import { axesOf } from './channels.js';
import { copy } from './clone.js';
import { type Column, clampRun, flush, pullRun, writeLater } from './columns.js';
import type { Values } from './fold.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Channel, Columns } from './types.js';
import type { Subject } from './voice.js';

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
  // Keeping last frame's pose is free when the mix allocated it; a host sampling into its own
  // object only pays for the copy once something in the mix has asked to retarget from it.
  let kept: O | undefined;
  if (out === undefined) kept = pose;
  else if (this.wantsPose) {
    kept = {} as O;
    for (const key of this.names) {
      const v = (pose as Record<string, unknown>)[key];
      if (v !== undefined) (kept as Record<string, unknown>)[key] = copy(v);
    }
  }
  if (kept !== undefined) {
    const rec = this.pose.get(subject);
    if (rec === undefined)
      this.pose.set(subject, { pose: kept, at: this.now, prev: undefined, prevAt: Number.NaN });
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
  if (mix.scratch === undefined) mix.scratch = {} as O;
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
  was.length = list.length;
  heads.length = list.length;
  if (mix.pulledSlots.length < list.length) {
    const slots = new Int32Array(Math.max(64, list.length));
    slots.set(mix.pulledSlots);
    mix.pulledSlots = slots;
  }
  const version = mix.version;
  const relinks = mix.relinks;
  const live = !Number.isNaN(now);
  const current = live && mix.pulledVersion === version && mix.pulledRelinks === relinks;
  try {
    readAll(mix, list, columns, live, current, whole);
  } finally {
    if (lanes !== null) flush(lanes);
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
      n = pullRun(
        lanes as Lanes<I, O>,
        slots,
        list,
        was,
        current ? null : heads,
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
        slots[n] = slot;
      }
    }
    const laned = live && lanes?.prepare(slot, subject, mix.version, heads[n] ?? null) === true;
    if (laned && whole && (lanes as Lanes<I, O>).whole && !(lanes as Lanes<I, O>).owes(slot)) {
      writeLater(lanes as Lanes<I, O>, slot, columns, n);
      continue;
    }
    const head = live ? (heads[n] as Subject<unknown>) : null;
    const folded = mix.foldWith(subject, scratch, head, laned, false);
    const pose = (mix.bounded.length === 0 ? folded : mix.clamp(folded as Values)) as Values;
    mix.keep(subject, pose as O, scratch);
    for (const c of columns) writeValue(c, pose[c.key], n);
  }
}

/** The kit slot, width, rest and bounds of every channel `pull` was handed an array for. */
function columnsOf<I, O>(mix: Mixer<I, O>, into: Columns<O>): Column[] {
  const columns: Column[] = [];
  for (const key of Object.keys(into)) {
    const out = (into as Record<string, Float64Array | undefined>)[key];
    if (out === undefined) continue;
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
    columns.push({ key, slot, axes, out, rest: at, bounds });
  }
  return columns;
}
