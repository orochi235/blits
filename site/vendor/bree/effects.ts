import { type ArcSpec, type ArcVoice, type Handle, type Mix, patch } from '@msb235/blits';
import type { Pose, Subject } from './board.js';
import { solid } from './modulators/color.js';
import { MODULATORS } from './modulators/index.js';
import { SLOTS, type Slot } from './moves/index.js';
import { groupsOf, type Order, type Placed, rowsToShow } from './orders.js';
import { duration } from './params.js';
import {
  type Piece,
  piecesOf,
  type SlotPieces,
  type StagedPiece,
  stagePiece,
  type Warning,
} from './pieces.js';
import type { EffectParam } from './tuning.js';

/** A message's coming on, standing and going, as pieces in each slot: plain data. */
export interface EffectSpec {
  readonly name: string;
  readonly about?: string;
  readonly enter?: SlotPieces;
  readonly active?: SlotPieces;
  readonly exit?: SlotPieces;
  /**
   * How long `active` plays, ms; an active piece with an `ms` setting left unset plays one pass
   * over it. Default: an active move's own length, else 0.
   */
  readonly hold?: number;
  /** A crossfade across each boundary, ms. Default 0. */
  readonly blend?: number;
  /** An order over the whole effect: one arc per group, each started a lag after the last. */
  readonly order?: Order;
  /** What a scene playing it can tune, by name. */
  readonly params?: Readonly<Record<string, EffectParam>>;
}

/** An effect as the arcs that play it, each with its start on the owner's clock. */
export interface StagedEffect {
  readonly arcs: readonly { readonly spec: ArcSpec<Subject, Pose>; readonly start: number }[];
  /** How long it keeps the sign, from the owner's 0. */
  readonly ms: number;
  /**
   * Where each part plays, from the owner's 0. With a lag the groups' parts overlap, so `enter`
   * runs until every group has come on, `exit` from the first group going, and `active` only while
   * every group stands: none at all when the lag spans the hold.
   */
  readonly parts: Readonly<Record<Slot, Stretch>>;
  readonly warnings: readonly Warning[];
  /** Where it waits for input and plays on again, from the owner's 0, in time order. */
  readonly stops: readonly Stop[];
}

/** A moment a pass paced by input waits at, or with `release`, plays on from. */
export interface Stop {
  readonly at: number;
  readonly release?: true;
}

/** A stretch of time, ms: where it starts and how long it lasts. */
export interface Stretch {
  readonly start: number;
  readonly ms: number;
}

/** A modulator setting `tint` outweighs the scene color rather than averaging with it evenly. */
const TINT_WEIGHT = 3;

const lengthOf = (v: ArcVoice<Subject, Pose>) => v.duration ?? v.patch.duration;

const onCells = (piece: Piece) => 'mod' in piece && MODULATORS[piece.mod].on === 'cells';

const weighed = ({ voice, writes }: StagedPiece): ArcVoice<Subject, Pose> =>
  writes.includes('tint') && voice.weight === undefined ? { ...voice, weight: TINT_WEIGHT } : voice;

/**
 * An effect staged for a message in a color: its arcs, how long it lasts, and what to warn about.
 * `hold` overrides the effect's own. Staged for the gpu engine (`gpu`), its moves are shader
 * patches where they can be.
 */
export function stageEffect(
  effect: EffectSpec,
  at: Placed,
  hex: number,
  hold?: number,
  gpu = false,
): StagedEffect {
  const groups = effect.order ? groupsOf(effect.order, at) : [at.board.dots];
  const lag = duration(effect.order?.lag) ?? 0;
  const span = (groups.length - 1) * lag;
  const given = duration(hold) ?? duration(effect.hold);
  const lists = SLOTS.map((slot) => piecesOf(effect[slot]));
  const pieceAt = (s: number, i: number) => (lists[s] ?? [])[i] as Piece;
  // An enter move leaves the message standing, and an exit move starts from it standing.
  const hasMove = (s: number) => (lists[s] ?? []).some((p) => 'move' in p);
  const joins = { from: hasMove(0), to: hasMove(2) };
  const stageAll = (subjects: readonly Subject[], keep: (piece: Piece) => boolean) =>
    SLOTS.map((slot, s) =>
      (lists[s] ?? [])
        .filter(keep)
        .map((piece) => stagePiece(piece, slot, at, subjects, given, joins, gpu)),
    );
  // Every piece staged once on the first group gives the warnings and the part lengths.
  const first = stageAll(groups[0] ?? [], () => true);
  const warnings: Warning[] = [];
  if (at.cut.length > 0) {
    const rows = rowsToShow(at.board, at.text);
    warnings.push({
      text: `${at.label ?? 'the message'} in the ${at.text.face.name} face runs off a ${at.board.rows}-row sign; a sign ${rows} rows tall shows all of it`,
      rows,
    });
  }
  SLOTS.forEach((slot, s) => {
    const pieces = first[s] ?? [];
    pieces.forEach((p, i) => {
      for (const w of p.warnings) warnings.push({ ...w, piece: i });
    });
    if (pieces.filter((p) => p.writes.includes('tint')).length > 1)
      warnings.push({ slot, text: `two pieces in ${slot} set tint` });
  });
  const lengths = first.map((pieces) => Math.max(0, ...pieces.map((p) => lengthOf(p.voice))));
  const activeMoves = (first[1] ?? []).flatMap((p, i) =>
    'move' in pieceAt(1, i) ? [lengthOf(p.voice)] : [],
  );
  const held = given ?? Math.max(0, ...activeMoves);
  const [enter = 0, , exit = 0] = lengths;
  const ms = span + enter + held + exit;

  /** An arc of `parts`, a `pin` voice in every part the effect has holding it to the shared lengths. */
  const arcOf = (
    parts: readonly (readonly StagedPiece[])[],
    pin: Omit<ArcVoice<Subject, Pose>, 'duration'>,
    active: number,
    start: number,
  ) => {
    const spec: { -readonly [K in Slot]?: ArcVoice<Subject, Pose>[] } = {};
    SLOTS.forEach((slot, s) => {
      if (lists[s]?.length === 0) return;
      const duration = s === 1 ? active : (lengths[s] as number);
      spec[slot] = [{ ...pin, duration }, ...(parts[s] ?? []).map(weighed)];
    });
    return {
      spec: { ...spec, hold: active, blend: duration(effect.blend) ?? 0 } as ArcSpec<Subject, Pose>,
      start,
    };
  };

  const color = solid(Math.max(1, ms), hex, gpu);
  const dots = (pieces: readonly StagedPiece[], s: number) =>
    pieces.filter((_, i) => !onCells(pieceAt(s, i)));
  // The scene color spans each group's arc as one voice layered into every part.
  const arcs = groups.map((subjects, g) =>
    arcOf(
      g === 0 ? first.map(dots) : stageAll(subjects, (piece) => !onCells(piece)),
      { patch: color, subjects },
      held,
      g * lag,
    ),
  );
  // Border cells are one subject set for the whole effect: one arc, its active over every group's.
  const cells = first.map((pieces, s) => pieces.filter((_, i) => onCells(pieceAt(s, i))));
  if (cells.some((pieces) => pieces.length > 0)) {
    const blank = patch<Subject, Pose>(Math.max(1, ms), () => ({}), { writes: [] });
    arcs.push(arcOf(cells, { patch: blank, subjects: at.board.cells }, held + span, 0));
  }
  const parts = {
    enter: { start: 0, ms: enter + span },
    active: { start: enter + span, ms: Math.max(0, held - span) },
    exit: { start: enter + held, ms: exit + span },
  };
  // Every group's pieces wait where the first group's do, a lag later each, and within a group
  // a piece's own order puts off each of its dots' rests by that dot's delay.
  const starts = [0, enter, enter + held];
  const own = first.flatMap((pieces, s) =>
    pieces.flatMap(({ rests, delays = [0] }) =>
      rests
        ? delays.flatMap((d) => {
            const from = (starts[s] as number) + d;
            return [
              ...rests.at.map((t) => ({ at: from + t })),
              { at: from + rests.release, release: true as const },
            ];
          })
        : [],
    ),
  );
  const stops = groups
    .flatMap((_, g) => own.map((stop) => ({ ...stop, at: stop.at + g * lag })))
    .sort((a, b) => a.at - b.at);
  return { arcs, ms, parts, warnings, stops };
}

/** Cues a staged effect's arcs under `owner`, each at its start; one of several is named by its index. */
export function cueEffect(
  m: Mix<Subject, Pose>,
  owner: Handle<Subject>,
  staged: StagedEffect,
  name: string,
): void {
  const many = staged.arcs.length > 1;
  staged.arcs.forEach(({ spec, start }, i) => {
    m.arc({ ...spec, name: many ? `${name} ${i}` : name, owner, start });
  });
}
