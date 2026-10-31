import { type Handle, mix } from '@msb235/blits';
import { rng } from '@stress/rng';
import type { Finding, Make, Scenario } from '@stress/scenario';
import { burst, type Loop, loops, type Pose, TILE, type Tile } from './pattern';
import { draw } from './view';

const FRAME_MS = 1000 / 60;
const TILES = 2000;
const FRAMES_PER_HOUR = 216_000;
const SWAP_EVERY = 18_000;
const BURST_EVERY = 1200;
const FADE_MS = 1200;
const SLEEP_MS = 30 * 60_000;
const SLEEP_AT = 1500;
const CHECK_AT = 3100;
const SETTLE_FRAMES = 120;
const MUTE_FRAMES = 60;
const TOL = 1e-6;
const SAMPLE = 8;
const GROWTH_SLACK = 2;

export const kiosk: Make = ({ seed, size, lanes }) => {
  const tiles: Tile[] = Array.from({ length: TILES }, (_, i) => ({ i }));
  const sample = Array.from({ length: SAMPLE }, (_, k) => tiles[(k * 251) % TILES] as Tile);
  /** Off the wall's tiles, so the shows' crossfades and the bursts never reach the clock loop. */
  const clockTiles: Tile[] = Array.from({ length: SAMPLE }, (_, k) => ({ i: TILES + k * 97 }));
  const { shows, clock } = loops(seed);
  /** Where in each 1,200-frame cycle a burst starts; it is over by the hourly check at 700. */
  const burstAt = 760 + rng(seed ^ 0x165667b1).int(400);
  const m = mix<Tile, Pose>(TILE, { name: 'kiosk', lanes });
  const gain = new Float64Array(TILES);
  const tint = new Float64Array(TILES * 4);
  const found: Finding[] = [];

  let slept = 0;
  let hostGap = 0;
  let showing = 0;
  let started = 0;
  let skipped = 0;
  let halted = false;
  let last = -1;
  let baseline = -1;
  let checks = 0;
  let current: Handle<Tile> | undefined;

  const host = (f: number) => f * FRAME_MS + hostGap;

  function show(f: number, pattern: number): void {
    current?.fade();
    current = m.cue({
      patch: (shows[pattern] as Loop).patch,
      subjects: tiles,
      loop: true,
      role: 'pattern',
      fade: { in: FADE_MS, out: FADE_MS },
      start: host(f),
    });
    showing = pattern;
    started = f;
    skipped = 0;
  }

  const hour = (f: number) => Math.floor(f / FRAMES_PER_HOUR);

  /**
   * Reads `subjects` against a fresh mix seeked to where arithmetic says `loop` stands, `frames`
   * frames of mix time after it started.
   */
  function drift(f: number, loop: Loop, frames: number, subjects: Tile[], name: string): void {
    const { period } = loop;
    const phaseMs = (frames * FRAME_MS) % period;
    const fresh = mix<Tile, Pose>(TILE, { name: 'kiosk-fresh', lanes });
    try {
      fresh.sync(0);
      fresh.cue({ patch: loop.patch, subjects, loop: true, seek: phaseMs });
      for (const t of subjects) {
        const want = fresh.probe(t);
        const got = m.probe(t);
        const bad = [
          got.gain - want.gain,
          ...got.color.map((v, k) => v - (want.color[k] as number)),
        ];
        if (bad.some((d) => !(Math.abs(d) <= TOL))) {
          found.push({
            kind: 'fail',
            at: f,
            what: `hour ${hour(f)} (host ${host(f)} ms), the ${name}: tile ${t.i} reads gain ${got.gain} color ${got.color}; a fresh mix started at phase ${phaseMs} ms of ${period} reads gain ${want.gain} color ${want.color}`,
          });
          return;
        }
      }
    } finally {
      fresh.close();
    }
  }

  function checkpoint(f: number): void {
    checks++;
    drift(f, shows[showing] as Loop, f - started - skipped, sample, 'show on the wall');
    drift(f, clock, f - slept, clockTiles, 'clock loop cued at frame 0');
    const n = m.voices().length;
    if (baseline < 0) baseline = n;
    if (n > baseline + GROWTH_SLACK) {
      found.push({
        kind: 'fail',
        at: f,
        what: `hour ${hour(f)}: ${n} voices at a quiet moment; the first checkpoint had ${baseline}`,
      });
    }
  }

  function step(f: number): void {
    last = f;
    const at = f % FRAMES_PER_HOUR;
    if (at === SLEEP_AT && !halted) {
      m.rebase();
      hostGap += SLEEP_MS - FRAME_MS;
      slept++;
      skipped++;
    }
    if (f === 0) m.cue({ patch: clock.patch, subjects: clockTiles, loop: true, start: host(0) });
    if (!halted) {
      if (f % SWAP_EVERY === 0) show(f, f === 0 ? 0 : (showing + 1) % shows.length);
      if (f % BURST_EVERY === burstAt) m.cue({ patch: burst, subjects: tiles });
    }
    m.sync(host(f));
    if (at === CHECK_AT && !halted) checkpoint(f);
  }

  function settle(): void {
    halted = true;
    for (let k = 0; k < SETTLE_FRAMES; k++) step(last + 1);
    checkpoint(last);
  }

  function rest(): void {
    m.mute({ over: 0 });
    for (let k = 0; k < MUTE_FRAMES; k++) step(last + 1);
    if (m.live || m.voices().length > 0) {
      found.push({
        kind: 'fail',
        at: last,
        what: `${MUTE_FRAMES} frames after mute({ over: 0 }), live is ${m.live} with ${m.voices().length} voices`,
      });
    }
  }

  const scenario: Scenario = {
    name: 'kiosk',
    frameMs: FRAME_MS,
    width: TILES * 5,
    step,
    read: (out) => {
      m.pull(tiles, { gain, color: tint });
      out.set(gain, 0);
      out.set(tint, TILES);
    },
    stats: () => ({ voices: m.voices().length, live: m.live ? 1 : 0, now: m.now, sleeps: slept }),
    check: () => {
      settle();
      rest();
      if (checks === 0) found.push({ kind: 'undecided', what: `size ${size}: no drift check ran` });
      return found;
    },
    draw: (ctx, w, h) => {
      m.pull(tiles, { gain, color: tint });
      draw(ctx, w, h, gain, tint);
    },
    close: () => m.close(),
  };
  return scenario;
};
