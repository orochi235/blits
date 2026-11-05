import { same } from './history.js';
import { transport as makeTransport } from './transport.js';
import type { HistoryOptions, TapeMaker } from './types/history.js';
import type { Mix } from './types/mix.js';
import type { Transport } from './types/transport.js';

/**
 * What a driver's scene is made on: a mix built with these options plays it. A driver that makes
 * its own mix passes them on; one that takes the host's mix makes that mix with them.
 *
 * @category patch
 */
export interface DriverMixOptions {
  name: string;
  history: HistoryOptions;
  /** Set when the scene plays on a shared transport, which then owns `history`. */
  transport?: Transport;
}

/** @category patch */
export interface DriverRun {
  // biome-ignore lint/suspicious/noExplicitAny: any mix a driver plays on
  mix: Mix<any, any, any>;
  /** What the host calls each frame after the mix, or its transport, syncs. */
  frame(): void;
  /**
   * What the driver has put out, as plain data compared with `same`: all of it so far, or what
   * this frame put out where that is what a paused mix holds still, as values written ahead.
   */
  output(): unknown;
  /** How much the driver keeps, checked not to grow as the mix plays on. */
  size?(): number;
  /**
   * A call the host makes on the driver once, such as an impulse on a body, for a scene that
   * `restores`: checked to be made again after a seek back past it, and to be left behind when
   * another host call after the seek starts a new future, until `tape.switchBranch` picks the old.
   */
  call?(): void;
}

/** @category patch */
export interface DriverScene {
  /** Makes the driver and its scene, cued and ready for the first frame. */
  make(opts: DriverMixOptions): DriverRun;
  /** The `history.tape` the checks seek with. */
  tape: TapeMaker;
  /**
   * Whether a seek back and forward again puts out what played: true for a driver whose output
   * follows the mix's state, false for one whose output, once sent, is not taken back.
   */
  restores: boolean;
  /** Frames each check plays, 16 ms apart so every time is exact. Default 240. */
  frames?: number;
}

const FRAME = 16;
const at = (f: number) => 1000 + f * FRAME;

/** A run of the scene, alone or on a transport, frame `f` at host time `at(f) + shift`. */
function run(scene: DriverScene, shared: boolean, ms = 60_000) {
  const history: HistoryOptions = { ms, tape: scene.tape };
  const t = shared ? makeTransport({ history }) : undefined;
  const r = scene.make(
    t === undefined ? { name: 'driver', history } : { name: 'driver', history, transport: t },
  );
  let shift = 0;
  return {
    r,
    frame(f: number) {
      const now = at(f) + shift;
      if (t === undefined) r.mix.sync(now);
      else t.sync(now);
      r.frame();
      return r.output();
    },
    seek(from: number, to: number) {
      if (t === undefined) r.mix.seek(r.mix.now - (at(from) - at(to)));
      else t.seek(t.now - (at(from) - at(to)));
      shift += at(from) - at(to);
    },
    get tape() {
      return r.mix.tape as NonNullable<DriverRun['mix']['tape']>;
    },
    set rate(v: number) {
      if (t === undefined) r.mix.rate = v;
      else t.rate = v;
    },
    rebase() {
      if (t === undefined) r.mix.rebase();
      else t.rebase();
    },
    skip(ms: number) {
      shift += ms;
    },
  };
}

/** A short rendering of an output, for a problem's sentence. */
const show = (v: unknown) => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What a driver does that a host cannot rely on, one sentence per problem; empty when none. It
 * plays the scene alone and on a shared transport and checks they put out the same each frame;
 * that a paused mix puts out nothing new; that a hidden tab taken out by `rebase` puts out what
 * playing straight through does; that, for a scene that `restores`, a seek back and forward again
 * puts out what played, two seeks with no frame between included, and a `call` the run gives is
 * made again past a seek back, left behind by a host call after it, and brought back by
 * `switchBranch`; and that `size`, where given, does not grow as the mix plays on. Meant for
 * a driver's own tests: `expect(checkDriver(scene)).toEqual([])`.
 *
 * @category patch
 */
export function checkDriver(scene: DriverScene): string[] {
  const problems: string[] = [];
  const frames = scene.frames ?? 240;
  const half = Math.floor(frames / 2);

  let want: unknown[];
  try {
    const alone = run(scene, false);
    want = [];
    for (let f = 0; f <= frames; f++) want.push(alone.frame(f));
  } catch (e) {
    return [`threw playing alone: ${describe(e)}`];
  }
  /** The first frame `play` puts out other than `expected` says, as a sentence's end. */
  const first = (play: (f: number) => unknown, from: number, expected: (f: number) => unknown) => {
    for (let f = from; f <= frames; f++) {
      const got = play(f);
      if (!same(got, expected(f))) return `${show(got)} at frame ${f}, where ${show(expected(f))}`;
    }
    return undefined;
  };

  try {
    const shared = run(scene, true);
    const off = first(
      (f) => shared.frame(f),
      0,
      (f) => want[f],
    );
    if (off !== undefined) problems.push(`on a shared transport it puts out ${off} alone`);
  } catch (e) {
    problems.push(`threw on a shared transport: ${describe(e)}`);
  }

  try {
    const paused = run(scene, false);
    for (let f = 0; f <= half; f++) paused.frame(f);
    paused.rate = 0;
    const still = paused.frame(half + 1);
    for (let f = half + 2; f <= half + 30; f++) {
      const got = paused.frame(f);
      if (!same(got, still)) {
        problems.push(
          `at rate 0 it puts out ${show(got)}, ${f - half - 1} frames after ${show(still)}`,
        );
        break;
      }
    }
  } catch (e) {
    problems.push(`threw paused: ${describe(e)}`);
  }

  try {
    const hidden = run(scene, false);
    for (let f = 0; f <= half; f++) hidden.frame(f);
    hidden.skip(5000);
    hidden.rebase();
    // The sync after a rebase moves the mix clock nothing, so it plays a frame behind from there.
    const off = first(
      (f) => hidden.frame(f),
      half + 1,
      (f) => want[f - 1],
    );
    if (off !== undefined)
      problems.push(`after a rebase over a hidden tab it puts out ${off} played straight through`);
  } catch (e) {
    problems.push(`threw across a rebase: ${describe(e)}`);
  }

  try {
    const sought = run(scene, false);
    for (let f = 0; f <= frames; f++) sought.frame(f);
    const back = Math.floor(frames / 4);
    sought.seek(frames, back);
    const off = first(
      (f) => sought.frame(f),
      back + 1,
      (f) => want[f],
    );
    if (scene.restores && off !== undefined)
      problems.push(`after a seek back to frame ${back}, playing on puts out ${off} played first`);
  } catch (e) {
    problems.push(`threw across a seek: ${describe(e)}`);
  }

  if (scene.restores) problems.push(...seeksAgain(scene, frames, want, first));

  try {
    // A second of history, so what is kept for history's reach stops growing within the run.
    const long = run(scene, false, 1000);
    if (long.r.size !== undefined) {
      for (let f = 0; f <= frames; f++) long.frame(f);
      const before = long.r.size();
      for (let f = frames + 1; f <= 3 * frames; f++) long.frame(f);
      const later = long.r.size();
      if (later > before * 1.5 + 8)
        problems.push(
          `what it keeps grew from ${before} to ${later} over ${2 * frames} more frames`,
        );
    }
  } catch (e) {
    problems.push(`threw playing on: ${describe(e)}`);
  }
  return problems;
}

type First = (
  play: (f: number) => unknown,
  from: number,
  expected: (f: number) => unknown,
) => string | undefined;

/**
 * What a driver whose output follows the mix gets wrong across seeks beyond one seek back: two
 * seeks with no frame between, and, where the scene makes one, a call of its own on the tape.
 */
function seeksAgain(scene: DriverScene, frames: number, want: unknown[], first: First): string[] {
  const problems: string[] = [];
  const eighth = Math.floor(frames / 8);
  const quarter = Math.floor(frames / 4);
  const half = Math.floor(frames / 2);
  const on = half + quarter;
  try {
    const sought = run(scene, false);
    for (let f = 0; f <= frames; f++) sought.frame(f);
    sought.seek(frames, quarter);
    for (let f = quarter + 1; f <= half; f++) sought.frame(f);
    sought.seek(half, eighth);
    sought.seek(eighth, on);
    const off = first(
      (f) => sought.frame(f),
      on + 1,
      (f) => want[f],
    );
    if (off !== undefined)
      problems.push(
        `after a seek back to frame ${eighth} and on to ${on} with no frame between, playing on puts out ${off} played first`,
      );
  } catch (e) {
    problems.push(`threw across two seeks with no frame between: ${describe(e)}`);
  }

  if (run(scene, false).r.call === undefined) return problems;
  try {
    const called = run(scene, false);
    const wantCalled: unknown[] = [];
    // A replay makes the call in the sync of its frame, so that frame's output is read after it.
    const play = (r: ReturnType<typeof run>, f: number) => {
      const got = r.frame(f);
      if (f !== half) return got;
      r.r.call?.();
      return r.r.output();
    };
    for (let f = 0; f <= frames; f++) wantCalled.push(play(called, f));
    const sought = run(scene, false);
    for (let f = 0; f <= frames; f++) play(sought, f);
    sought.seek(frames, quarter);
    let off = first(
      (f) => sought.frame(f),
      quarter + 1,
      (f) => wantCalled[f],
    );
    // A check that fails stops its run short of the frame the next seek counts from.
    if (off !== undefined)
      return [
        ...problems,
        `after a seek back to frame ${quarter}, playing on past its call at frame ${half} puts out ${off} played first`,
      ];
    sought.seek(frames, quarter);
    sought.frame(quarter + 1);
    sought.r.mix.announce('checkDriver');
    off = first(
      (f) => sought.frame(f),
      quarter + 2,
      (f) => want[f],
    );
    if (off !== undefined)
      return [
        ...problems,
        `after a seek back and a host call starting a new future, it puts out ${off} with no call at frame ${half}`,
      ];
    sought.seek(frames, quarter);
    const old = sought.tape.branches().find((b) => !b.current);
    if (old !== undefined) sought.tape.switchBranch(old.id);
    off = first(
      (f) => sought.frame(f),
      quarter + 1,
      (f) => wantCalled[f],
    );
    if (off !== undefined)
      problems.push(
        `after switchBranch back to the future with its call at frame ${half}, it puts out ${off} played first`,
      );
  } catch (e) {
    problems.push(`threw across a seek past its call: ${describe(e)}`);
  }
  return problems;
}
