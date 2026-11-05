import type { Mixer } from '../mixer.js';
import type { Voice } from '../voice.js';
import { type Answers, varies } from './answers.js';
import type { Room } from './eligible.js';
import type { Mirror } from './mirror.js';
import type { Mirrors } from './mirrors.js';
import type { Reads } from './reads.js';
import type { Entry, Placement, Regions } from './region.js';
import { type ChannelLookup, type Packed, packOf, type Runner, unpack } from './runner.js';
import { elapsedOf, type Slot, type Table, voiceTable } from './table.js';
import { sizeOf, type Timings } from './timings.js';
import { unreadOf } from './unread.js';
import { perSubject, type Weighs, weighsOf } from './weight.js';

export interface Preparing<I> {
  readonly mix: Mixer<I, unknown>;
  readonly voices: readonly Voice<I, unknown>[];
  readonly runners: readonly Runner[];
  readonly index: ReadonlyMap<string, number>;
  readonly codes: ChannelLookup;
  readonly list: readonly I[];
  readonly answers: Answers<I>;
  readonly mirrors: Mirrors;
  readonly timings: Timings;
  readonly reads: Reads<I>;
  readonly regions: Regions;
  readonly limit: number;
}

/** What a voice takes of the values buffer and the per-subject buffer, for `n` subjects. */
export function roomOf<I>(
  v: Voice<I, unknown>,
  codes: ChannelLookup,
  n: number,
  answers: Answers<I>,
): Room {
  const p = packOf(v.patch, codes) as Extract<Packed, { runner: Runner }>;
  const rows = p.perSubject === undefined ? 0 : n * (p.runner.stride ?? 0);
  const asks = varies(v as Voice<unknown, unknown>);
  const block = asks ? sizeOf(answers.of(v), (v.fade.in ?? 0) > 0) : 0;
  const reads = perSubject(v) ? n : 0;
  return { values: p.values.length, persub: rows + block + reads };
}

/** The frame's table and placement, or 'unfit' where a mirror's stride disagreed and was unpacked. */
export function prepare<I>(p: Preparing<I>): { table: Table; placed: Placement } | 'unfit' {
  const { mix, voices, runners, codes, list, answers, mirrors: all, timings, reads } = p;
  const mirrors: (Mirror<unknown> | undefined)[] = [];
  const weighs = voices.map((v) => weighsOf(mix, v));
  const entries: Entry[] = voices.map((v, k) => {
    const packed = packOf(v.patch, codes) as Extract<Packed, { runner: Runner }>;
    if (packed.perSubject === undefined) {
      mirrors.push(undefined);
      return { owner: v, values: packed.values };
    }
    const u = v as Voice<I, unknown>;
    const delays = varies(u as Voice<unknown, unknown>) ? answers.of(u).delays : null;
    const m = all.of(v, packed.perSubject, packed.values, list, delays);
    // A host reading only these buffers never samples, so the changes it made are committed here.
    const now = mix.now;
    const horizon = mix.horizonFor(v, 0, now);
    const unread = unreadOf(mix, u, answers, timings, reads.of(u), weighs[k] as Weighs);
    if (delays === null) m.prepare(elapsedOf(v, now), horizon, { unread });
    else {
      const t = v.unstarted(now) && !v.holdsFirst ? Number.NaN : v.rawAt(now, 0);
      m.prepare(t, horizon, { holds: v.holdsFirst, unread });
    }
    mirrors.push(m as Mirror<unknown>);
    return { owner: v, values: m.values() };
  });
  // A patch packed before it met a subject could not check its axes; its mirror has met them now.
  const unfit = voices.filter((_, k) => {
    const m = mirrors[k];
    return m !== undefined && m.stride !== (runners[k] as Runner).stride;
  });
  if (unfit.length > 0) {
    for (const v of unfit) unpack(v.patch, codes);
    return 'unfit';
  }
  const subs = all.place(mirrors);
  const timing = timings.place(mix, voices, answers, all.length);
  const read = reads.place(voices, all.length + timings.length);
  // Each fade curve's entry after every voice's, at `curves[k]` for voice k.
  const curves = voices.map((v) => {
    const c = timings.curveOf(v as Voice<unknown, unknown>);
    if (c === undefined) return undefined;
    entries.push(c);
    return entries.length - 1;
  });
  const placed = p.regions.frame(entries, p.limit / 4);
  const slots: Slot[] = runners.map((r, k) => {
    const c = curves[k];
    const w = read[k];
    return {
      runner: p.index.get(r.key) as number,
      values: placed.offsets[k] as number,
      sub: subs[k] as number,
      timing: timing[k],
      ...(c === undefined ? {} : { ease: placed.offsets[c] as number }),
      ...(w === undefined ? {} : { weights: w }),
    };
  });
  return { table: voiceTable(mix, voices, slots, weighs), placed };
}
