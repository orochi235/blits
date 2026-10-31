import { rng } from '@stress/rng';
import type { Finding, Make, Scenario } from '@stress/scenario';
import { build, FRAME_MS, type Pose, playhead, readInto, where } from './build';
import { editor } from './script';
import { draw } from './view';

const CHECKPOINTS = 20;
const TOLERANCE = 1e-6;
/** Frame lengths the fresh timelines step by; the first is the live one. */
const STEPS = [FRAME_MS, 1000 / 61, 1000 / 120, 1000 / 30];

interface Checkpoint {
  frame: number;
  now: number;
  /** The reel's clock: the timeline time on screen. */
  at: number;
  values: Float64Array;
  recent: string[];
}

const same = (a: number, b: number) =>
  Object.is(a, b) || Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

export const timeline: Make = ({ seed, size, lanes }) => {
  const t = build(seed, size, lanes);
  const ed = editor(seed, t);
  const width = t.clips.length * 6;
  const pick = rng(seed + 0x2545f491);
  const pose: Pose = t.m.pose();
  const kept: Checkpoint[] = [];
  let seen = 0;
  let at = 0;
  let checked = 0;
  let framedAt = 0;

  /** Keeps a uniform sample of `CHECKPOINTS` frames out of however many play. */
  function sample(f: number): void {
    seen++;
    const slot = kept.length < CHECKPOINTS ? kept.length : pick.int(seen);
    if (slot >= CHECKPOINTS) return;
    const values = new Float64Array(width);
    readInto(t, values);
    kept[slot] = {
      frame: f,
      now: t.m.now,
      at,
      values,
      recent: ed.recent(),
    };
  }

  function step(f: number): void {
    ed.act(f, at);
    t.m.sync(f * FRAME_MS);
    at = playhead(t, pose);
    sample(f);
  }

  /**
   * Plays fresh timelines forward at rate 1, each sync landing exactly on a checkpoint's reel time:
   * one at the live frame rate, the rest at others. Numbers on which they disagree depend on the
   * frame rate alone, so a live mismatch there says nothing about seeks or rates.
   */
  function check(): Finding[] {
    const found: Finding[] = [...ed.findings()];
    const order = kept.slice().sort((a, b) => a.at - b.at || a.frame - b.frame);
    const runs = STEPS.map((ms) => {
      const fresh = build(seed, size, lanes);
      fresh.m.sync(0);
      return { ms, fresh, time: 0, got: new Float64Array(width) };
    });
    const n0 = t.clips.length;
    let framed: Finding | undefined;
    for (const cp of order) {
      for (const run of runs) {
        const from = run.time;
        const n = Math.ceil((cp.at - from) / run.ms - 1e-9);
        for (let j = 1; j <= n; j++) {
          run.time = j === n ? cp.at : from + ((cp.at - from) * j) / n;
          run.fresh.m.sync(run.time);
          readInto(run.fresh, run.got);
        }
        readInto(run.fresh, run.got);
      }
      checked++;
      const base = runs[0] as (typeof runs)[number];
      const unstable = new Set<number>();
      for (const run of runs.slice(1)) {
        for (let k = 0; k < width; k++) {
          if (same(base.got[k] as number, run.got[k] as number)) continue;
          if (!framed) {
            const { clip, field } = where(n0, k);
            framed = {
              kind: 'fail',
              at: cp.frame,
              what:
                `a fresh timeline played forward at rate 1 reads differently by frame rate alone: at reel ${cp.at.toFixed(3)}, ` +
                `clip ${clip} ${field} is ${base.got[k]} at ${(1000 / base.ms).toFixed(0)} fps and ${run.got[k]} at ${(1000 / run.ms).toFixed(0)} fps`,
            };
          }
          unstable.add(k);
        }
      }
      if (unstable.size > 0) framedAt++;
      const failing: number[] = [];
      for (let k = 0; k < width; k++)
        if (!unstable.has(k) && !same(cp.values[k] as number, base.got[k] as number))
          failing.push(k);
      const k = failing[0];
      if (k !== undefined) {
        const { clip, field } = where(n0, k);
        found.push({
          kind: 'fail',
          at: cp.frame,
          what:
            `frame ${cp.frame}, reel at ${cp.at.toFixed(3)} (mix time ${cp.now.toFixed(3)}): ` +
            `clip ${clip} ${field} live ${cp.values[k]} fresh ${base.got[k]}, ${failing.length} of ${width} numbers differ; ` +
            `recent: ${cp.recent.join('; ')}`,
        });
      }
    }
    if (framed) found.push(framed);
    for (const run of runs) run.fresh.m.close();
    return found;
  }

  const scenario: Scenario = {
    name: 'timeline',
    frameMs: FRAME_MS,
    width,
    step,
    read: (out) => readInto(t, out),
    stats: () => ({
      voices: t.m.voices().length,
      now: t.m.now,
      reel: at,
      checked,
      framedAt,
      ...ed.stats(),
    }),
    check,
    draw: (ctx, w, h) => draw(t, ctx, w, h, at),
    close: () => t.m.close(),
  };
  return scenario;
};
