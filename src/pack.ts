import { clone } from './clone.js';
import type { Subject, Voice } from './voice.js';

/** A subject's record as plain data, for a history store. */
export interface PackedRecord {
  reaches: boolean;
  delay: number;
  since: number;
  shown: number;
  weight: number;
  rested: boolean;
  bands: number[] | null;
  state: unknown;
  stepped: number;
  ticks: number;
  /**
   * What `setting.keep` held, in the order its owners first kept it. An owner is code, which no
   * store keeps, and a voice revived from a descriptor has new ones; the same code keeps in the same
   * order, so each owner takes the next value on its first keep.
   */
  kept: unknown[] | null;
  base?: Record<string, unknown>;
  slope?: Record<string, unknown>;
  snaps?: [at: number, held: PackedRecord][];
  inputs?: { at: number; value: number }[];
}

/** A voice's record of one subject as plain data, its patch's `pack` taking its state. */
export function packHeld<I, O>(voice: Voice<I, O>, h: Subject<unknown>): PackedRecord {
  const patch = voice.patch;
  const kept = [...(h.kept?.values() ?? []), ...(h.unkept ?? [])];
  const p: PackedRecord = {
    reaches: h.reaches,
    delay: h.delay,
    since: h.since,
    shown: h.shown,
    weight: h.weight,
    rested: h.rested,
    bands: h.bands === null ? null : Array.from(h.bands),
    state: h.state === undefined ? undefined : patch.pack ? patch.pack(h.state) : clone(h.state),
    stepped: h.stepped,
    ticks: h.ticks,
    kept: kept.length === 0 ? null : kept.map(clone),
  };
  if (h.base !== undefined) p.base = clone(h.base);
  if (h.slope !== undefined) p.slope = clone(h.slope);
  if (h.snaps !== undefined) p.snaps = h.snaps.map((s) => [s.at, packHeld(voice, s.held)]);
  if (h.inputs !== undefined) p.inputs = h.inputs.map((e) => ({ ...e }));
  return p;
}

/** A record made again from `packHeld`'s data, for `voice`. */
export function unpackHeld<I, O>(voice: Voice<I, O>, p: PackedRecord): Subject<unknown> {
  const patch = voice.patch;
  const h: Subject<unknown> = {
    reaches: p.reaches,
    delay: p.delay,
    since: p.since,
    shown: p.shown,
    weight: p.weight,
    rested: p.rested,
    bands: p.bands === null ? null : Uint8Array.from(p.bands),
    state: p.state === undefined ? undefined : patch.unpack ? patch.unpack(p.state) : p.state,
    stepped: p.stepped,
    ticks: p.ticks,
    probed: Number.NaN,
    delta: null,
    phase: 0,
    seeks: 0,
    kept: null,
    voice,
    next: null,
    version: Number.NaN,
    loci: null,
    slot: -1,
  };
  if (p.kept !== null) h.unkept = p.kept;
  if (p.base !== undefined) h.base = p.base;
  if (p.slope !== undefined) h.slope = p.slope;
  if (p.snaps !== undefined)
    h.snaps = p.snaps.map(([at, held]) => ({ at, held: unpackHeld(voice, held) }));
  if (p.inputs !== undefined) h.inputs = p.inputs;
  return h;
}
