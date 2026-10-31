import { rng } from '@stress/rng';
import type { Build, Deck } from './build';
import { FRAME_MS } from './build';

const RECENT = 5;
const MIN_GAP = 60;
const GAP_SPREAD = 60;
/** A second press while the first build is still playing, in frames after the first. */
const MID_MIN = 3;
const MID_SPREAD = 12;

export interface Target {
  build: Build;
  /** Frame the deck has settled at: the build has played out. */
  settleAt: number;
  recent: string[];
}

/**
 * A presenter stepping through the deck. NEXT (70%), BACK (15%), a jump to a seeded slide (5%), and
 * NEXT pressed again mid-build (10%); each is a `seek` to the target build's start mark. A press
 * that another cuts short is superseded and never settles.
 */
export function presenter(seed: number, d: Deck) {
  const r = rng(seed ^ 0x9e3779b9);
  const last = d.builds.length - 1;
  const slides = (d.builds[last] as Build).slide + 1;
  const recent: string[] = [];
  const errors: string[] = [];
  let at = 0;
  let next = 20 + r.int(MIN_GAP);
  let second = -1;
  let pending: Target | undefined;
  let seeks = 0;
  let backs = 0;
  let jumps = 0;
  let mids = 0;
  let superseded = 0;

  const log = (f: number, what: string) => {
    recent.push(`f${f} ${what}`);
    if (recent.length > RECENT) recent.shift();
  };

  function go(f: number, to: number, what: string): void {
    const b = d.builds[to] as Build;
    log(
      f,
      `${what} → slide ${b.slide} build ${b.build} (mix ${d.m.now.toFixed(1)} → ${b.start.toFixed(1)})`,
    );
    try {
      d.m.seek(b.start);
    } catch (e) {
      errors.push(
        `${what} to slide ${b.slide} build ${b.build} threw ${String(e)}; recent: ${recent.join('; ')}`,
      );
      return;
    }
    seeks++;
    if (pending) superseded++;
    at = to;
    pending = {
      build: b,
      settleAt: f + Math.ceil(b.ms / FRAME_MS) + 1,
      recent: recent.slice(),
    };
  }

  const press = (f: number) => go(f, at >= last ? 0 : at + 1, at >= last ? 'wrap' : 'next');

  /** Makes frame `f`'s presses, before its sync. */
  function act(f: number): void {
    if (f === second) {
      mids++;
      press(f);
      second = -1;
    }
    if (f !== next) return;
    next = f + MIN_GAP + r.int(GAP_SPREAD);
    const roll = r.next();
    if (roll < 0.7) press(f);
    else if (roll < 0.85) {
      backs++;
      go(f, at > 0 ? at - 1 : 1, at > 0 ? 'back' : 'next');
    } else if (roll < 0.9) {
      jumps++;
      const s = r.int(slides);
      go(
        f,
        d.builds.findIndex((b) => b.slide === s),
        `jump to slide ${s}`,
      );
    } else {
      press(f);
      second = f + MID_MIN + r.int(MID_SPREAD);
    }
  }

  /** The press that has settled by frame `f`, handed over once. */
  function settled(f: number): Target | undefined {
    if (!pending || f < pending.settleAt) return undefined;
    const t = pending;
    pending = undefined;
    return t;
  }

  return {
    act,
    settled,
    recent: () => recent.slice(),
    errors: () => errors,
    stats: () => ({ seeks, backs, jumps, mids, superseded, slide: (d.builds[at] as Build).slide }),
  };
}
