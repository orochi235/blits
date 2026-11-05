import type { ArcVoice } from '@msb235/blits';
import { everyOf, type Pose, type Subject } from './board.js';
import { MODULATORS, type ModulatorName } from './modulators/index.js';
import { ranked } from './modulators/shader.js';
import { type Joins, LOOSE, MOVES, type MoveName, type Rests, type Slot } from './moves/index.js';
import type { MoveShader } from './moves/shader.js';
import { delayOf, type Order, type Placed, rankOf, spanOf } from './orders.js';
import { type Params, type ParamValue, values } from './params.js';
import type { Channel } from './planes.js';

/** A move played in an order. */
export interface MovePiece {
  readonly move: MoveName;
  readonly order?: Order;
  readonly params?: Readonly<Record<string, ParamValue>>;
}

/** A modulator played in a spread. */
export interface ModPiece {
  readonly mod: ModulatorName;
  readonly spread?: Order;
  readonly params?: Readonly<Record<string, ParamValue>>;
}

export type Piece = MovePiece | ModPiece;
export type SlotPieces = Piece | readonly Piece[];

/** Something staging found worth saying, and the slot and piece it is about where it is about one. */
export interface Warning {
  readonly slot?: Slot;
  /** The piece's index in its slot. */
  readonly piece?: number;
  readonly text: string;
  /** For dots the sign cuts off: how many rows a sign needs to show all of them. */
  readonly rows?: number;
}

/** A piece as a voice of an arc, with what it writes and what to warn about. */
export interface StagedPiece {
  readonly voice: ArcVoice<Subject, Pose>;
  readonly writes: readonly Channel[];
  readonly warnings: readonly Warning[];
  /** Where it waits for input, from its own start; absent when it is paced by time. */
  readonly rests?: Rests;
  /**
   * Each delay its own order gives its dots, least first, so the rests are folded in once a
   * delay; present with `rests`.
   */
  readonly delays?: readonly number[];
}

/** Every subject at once: the order a piece plays in when it names none. */
export const TOGETHER: Order = { by: 'together' };

/** A slot's pieces as a list. */
export const piecesOf = (p: SlotPieces | undefined): readonly Piece[] =>
  p === undefined ? [] : Array.isArray(p) ? (p as readonly Piece[]) : [p as Piece];

/** The channels a piece writes: a move draws the message on `lit`; a modulator writes what it names. */
export const writesOf = (piece: Piece): readonly Channel[] =>
  'mod' in piece ? MODULATORS[piece.mod].writes : ['lit'];

/** A piece's settings; in `active` with a hold, an `ms` it leaves unset is one pass over the hold. */
function settingsOf(
  thing: { readonly params: Params },
  piece: Piece,
  slot: Slot,
  hold: number | undefined,
): never {
  const p = values(thing, piece.params as never);
  const perHold =
    slot === 'active' &&
    hold !== undefined &&
    hold > 0 &&
    'ms' in thing.params &&
    piece.params?.ms === undefined;
  return (perHold ? { ...p, ms: hold } : p) as never;
}

/**
 * A piece as the arc voice that plays it in `slot`; modulators and `active` moves loop. `hold` is
 * the effect's, where one is given, and `joins` says an active move's neighbors hold the message.
 * Staged for the gpu engine (`gpu`), a modulator, and a move playing on all its dots at once, is a
 * shader patch where it has one.
 */
export function stagePiece(
  piece: Piece,
  slot: Slot,
  at: Placed,
  subjects: readonly Subject[],
  hold?: number,
  joins: Joins = LOOSE,
  gpu = false,
): StagedPiece {
  const loop = slot === 'active';
  if ('mod' in piece) {
    const mod = MODULATORS[piece.mod];
    const p = settingsOf(mod, piece, slot, hold);
    const own = mod.on === 'cells' ? at.board.cells : subjects;
    const spread = piece.spread ?? TOGETHER;
    const shaded = gpu ? mod.shader?.(at, p, ranked(spread, at.board)) : null;
    const voice: ArcVoice<Subject, Pose> = {
      patch: shaded ?? mod.patch(at, p, rankOf(spread, at)),
      subjects: own,
      ...(loop && { loop: true }),
    };
    return { voice, writes: writesOf(piece), warnings: [] };
  }
  const move = MOVES[piece.move];
  if (move.slot !== slot) throw new Error(`bree: ${piece.move} is an ${move.slot} move`);
  const p = settingsOf(move, piece, slot, hold);
  const order = piece.order ?? TOGETHER;
  const delay = delayOf(order, at);
  const span = spanOf(order, at);
  const shaded = gpu && span === 0 ? move.shader?.(at, p, joins) : null;
  const pass = shaded ? null : (move.patch(at, p, joins) as ArcVoice<Subject, Pose>['patch']);
  const whole = subjects.length === at.board.dots.length;
  const voice: ArcVoice<Subject, Pose> = {
    ...(pass
      ? { patch: pass, subjects, stagger: delay, duration: pass.duration + span }
      : { patch: shaded as MoveShader, subjects: whole ? everyOf(at.board) : subjects }),
    ...(loop && { loop: true }),
  };
  const clips = at.text.cols > at.board.cols && !move.wide;
  const warnings = clips
    ? [{ slot, text: `${piece.move} clips ${at.label ?? 'the message'}` }]
    : [];
  const rests = move.rests?.(at, p) ?? null;
  if (!rests) return { voice, writes: writesOf(piece), warnings };
  const delays = [...new Set(subjects.filter((s) => s.kind === 'dot').map(delay))].sort(
    (a, b) => a - b,
  );
  return { voice, writes: writesOf(piece), warnings, rests, delays };
}
