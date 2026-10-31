import { rng } from '@stress/rng';
import type { Finding, Make, Scenario } from '@stress/scenario';
import { build, FRAME_MS, readInto, where } from './build';
import { doneWatch } from './done';
import { presenter } from './script';

const CHECKPOINTS = 40;
const TOLERANCE = 1e-6;
/** The fresh decks' frame lengths; the first is the live one. */
const STEPS = [FRAME_MS, 1000 / 45];

interface Checkpoint {
  frame: number;
  /** The mix time the live deck read at, and the start mark it was sought to. */
  now: number;
  start: number;
  label: string;
  values: Float64Array;
  recent: string[];
}

const same = (a: number, b: number) =>
  Object.is(a, b) || Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

export const deck: Make = ({ seed, size, lanes }) => {
  const d = build(seed, size, lanes);
  const pres = presenter(seed, d);
  const watch = doneWatch(d.handles);
  const width = d.elems.length * 2;
  const pick = rng(seed + 0x2545f491);
  const kept: Checkpoint[] = [];
  let seen = 0;
  let checked = 0;
  let framedAt = 0;

  function record(f: number): void {
    const t = pres.settled(f);
    if (!t) return;
    seen++;
    const slot = kept.length < CHECKPOINTS ? kept.length : pick.int(seen);
    if (slot >= CHECKPOINTS) return;
    const values = new Float64Array(width);
    readInto(d, values);
    kept[slot] = {
      frame: f,
      now: d.m.now,
      start: t.build.start,
      label: `slide ${t.build.slide} build ${t.build.build}`,
      values,
      recent: t.recent,
    };
  }

  function step(f: number): void {
    pres.act(f);
    d.m.sync(f * FRAME_MS);
    watch.scan(f);
    record(f);
  }

  /**
   * Fresh decks sought straight to a checkpoint's build and played on to its mix time, at the live
   * frame length and at another. Numbers on which they disagree depend on the frame rate alone, so
   * they are reported once and left out of the comparison with the live deck.
   */
  function check(): Finding[] {
    const found: Finding[] = [
      ...pres.errors().map((what) => ({ kind: 'fail' as const, what })),
      ...watch.findings(),
    ];
    if (!d.marked) {
      found.push({
        kind: 'gap',
        what: 'marks did not list every build’s start, so the scenario computed those starts itself',
      });
    }
    let framed: Finding | undefined;
    for (const cp of kept.slice().sort((a, b) => a.frame - b.frame)) {
      const runs = STEPS.map((ms) => {
        const fresh = build(seed, size, lanes);
        const got = new Float64Array(width);
        const delta = cp.now - cp.start;
        const n = Math.max(1, Math.ceil(delta / ms - 1e-9));
        fresh.m.seek(cp.start);
        for (let j = 1; j <= n; j++) fresh.m.sync(j === n ? delta : (delta * j) / n);
        readInto(fresh, got);
        fresh.m.close();
        return { ms, got };
      });
      checked++;
      const base = runs[0] as (typeof runs)[number];
      const unstable = new Set<number>();
      for (const run of runs.slice(1)) {
        for (let k = 0; k < width; k++) {
          if (same(base.got[k] as number, run.got[k] as number)) continue;
          framed ??= {
            kind: 'fail',
            at: cp.frame,
            what:
              `a fresh deck sought to ${cp.label} reads differently by frame rate alone: ${where(d, k)} is ` +
              `${base.got[k]} at ${(1000 / base.ms).toFixed(0)} fps and ${run.got[k]} at ${(1000 / run.ms).toFixed(0)} fps`,
          };
          unstable.add(k);
        }
      }
      if (unstable.size > 0) framedAt++;
      let first = -1;
      let differ = 0;
      for (let k = 0; k < width; k++) {
        if (unstable.has(k) || same(cp.values[k] as number, base.got[k] as number)) continue;
        differ++;
        if (first < 0) first = k;
      }
      if (first < 0) continue;
      found.push({
        kind: 'fail',
        at: cp.frame,
        what:
          `frame ${cp.frame}, settled on ${cp.label} at mix ${cp.now.toFixed(3)}: ${where(d, first)} live ` +
          `${cp.values[first]} fresh ${base.got[first]}, ${differ} of ${width} numbers differ; recent: ${cp.recent.join('; ')}`,
      });
    }
    if (framed) found.push(framed);
    return found;
  }

  const scenario: Scenario = {
    name: 'deck',
    frameMs: FRAME_MS,
    width,
    step,
    read: (out) => readInto(d, out),
    stats: () => ({
      voices: d.m.voices().length,
      now: d.m.now,
      checked,
      framedAt,
      ...pres.stats(),
      ...watch.stats(),
    }),
    check,
    close: () => d.m.close(),
  };
  return scenario;
};
