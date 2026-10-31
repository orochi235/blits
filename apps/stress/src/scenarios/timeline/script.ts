import { rng } from '@stress/rng';
import type { Finding } from '@stress/scenario';
import { END, HISTORY_MS, type Timeline } from './build';

/** The shuttle speeds an editor reaches for: J, K and L pressed once, twice, or held. */
const SPEEDS = [-2, -1, -0.5, 0.5, 1, 2, 4];
const RECENT = 5;
/** How far back a jump or scrub reaches, inside what history keeps. */
const REACH_MS = HISTORY_MS - 10_000;
const HEAD_MS = 400;

type Op =
  | { kind: 'seek'; to: number }
  | { kind: 'scrub'; frames: number; by: number }
  | { kind: 'rate'; to: number }
  | { kind: 'ramp'; to: number; over: number }
  | { kind: 'jump'; to: number };

/**
 * A video editor at the timeline, one action every 30 to 90 frames, drawn from the seed as play
 * reaches it. It plays at speed `|s|` on the mix and in the direction of `s` on the reel, since the
 * mix's own rate cannot go below 0.
 */
export function editor(seed: number, t: Timeline) {
  const r = rng(seed ^ 0x5bd1e995);
  const recent: string[] = [];
  const found: Finding[] = [];
  let next = 30 + r.int(61);
  let scrub: { left: number; per: number } | undefined;
  let tried = false;
  let seeks = 0;
  let reversals = 0;
  let jumpedAt = -1;

  const log = (f: number, what: string) => {
    recent.push(`f${f} ${what}`);
    if (recent.length > RECENT) recent.shift();
  };

  function seek(f: number, to: number, what: string): void {
    const { m } = t;
    const target = Math.max(0, to);
    const from = m.now;
    try {
      m.seek(target);
      seeks++;
    } catch (e) {
      if (target >= from - HISTORY_MS) {
        found.push({
          kind: 'fail',
          at: f,
          what: `${what} from mix time ${from.toFixed(3)} to ${target.toFixed(3)} threw ${String(e)}; recent: ${recent.join('; ')}`,
        });
      }
    }
  }

  function draw(): Op {
    const { m } = t;
    const roll = r.next();
    if (roll < 0.2) {
      const back = r.next() < 0.8;
      const to = back ? m.now - r.next() * Math.min(m.now, REACH_MS) : m.now + r.next() * 5000;
      return { kind: 'seek', to };
    }
    if (roll < 0.4) return { kind: 'scrub', frames: 10 + r.int(21), by: (r.next() - 0.6) * 6000 };
    if (roll < 0.65) return { kind: 'rate', to: r.pick(SPEEDS) };
    if (roll < 0.85) return { kind: 'ramp', to: r.pick(SPEEDS), over: 200 + r.int(1300) };
    return { kind: 'jump', to: r.next() * END };
  }

  function direction(s: number): void {
    const { m, reel } = t;
    if (s < 0 && !tried) {
      tried = true;
      try {
        m.rate = s;
      } catch {
        found.push({
          kind: 'gap',
          what: 'the mix’s rate cannot go below 0, so the editor plays in reverse by turning back the owner every sequence plays under',
        });
      }
    }
    if (Math.sign(s) !== Math.sign(reel.rate)) {
      reel.rate = Math.sign(s);
      if (s < 0) reversals++;
    }
  }

  function apply(f: number, op: Op): void {
    const { m, reel } = t;
    switch (op.kind) {
      case 'seek':
        log(f, `seek ${m.now.toFixed(1)} → ${Math.max(0, op.to).toFixed(1)}`);
        seek(f, op.to, 'a jump');
        return;
      case 'scrub':
        log(f, `scrub ${op.by.toFixed(1)} ms over ${op.frames} frames from ${m.now.toFixed(1)}`);
        scrub = { left: op.frames, per: op.by / op.frames };
        return;
      case 'rate':
        log(f, `rate ${op.to}`);
        direction(op.to);
        m.rate = Math.abs(op.to);
        return;
      case 'ramp': {
        log(f, `ramp to ${op.to} over ${op.over} ms`);
        const sign = Math.sign(op.to);
        if (sign !== Math.sign(reel.rate)) {
          if (sign < 0) reversals++;
          reel.ramp(sign, op.over);
        }
        m.ramp(Math.abs(op.to), op.over);
        return;
      }
      case 'jump':
        log(f, `reel to ${op.to.toFixed(1)}`);
        reel.seek(op.to);
        jumpedAt = f;
        return;
    }
  }

  /** Makes frame `f`'s calls, before its sync. `at` is the reel's clock as the last frame read it. */
  function act(f: number, at: number): void {
    const { reel } = t;
    if (reel.rate < 0 && at < HEAD_MS) {
      log(f, `head at ${at.toFixed(1)}: forward`);
      reel.rate = 1;
    } else if (reel.rate > 0 && at > END + 1000) {
      apply(f, { kind: 'jump', to: r.next() * END * 0.5 });
    }
    if (scrub) {
      seek(f, t.m.now + scrub.per, 'a scrub');
      if (--scrub.left === 0) scrub = undefined;
    }
    if (f === next) {
      apply(f, draw());
      next = f + 30 + r.int(61);
    }
  }

  return {
    act,
    recent: () => recent.slice(),
    findings: () => found,
    /** Whether frame `f` sought the reel. */
    jumped: (f: number) => jumpedAt === f,
    stats: () => ({ seeks, reversals }),
  };
}
