# Stress demos

Seven workloads shaped like real apps. They find where blits is slow, where it is wrong, and where
it cannot say what an app needs. Each one runs headless, for numbers and checks, and on a canvas,
to watch. For whoever runs them or adds one.

## The demos

| Name | Stands for | Load | Correct means |
|---|---|---|---|
| `heatmap` | A trading screen | 1,000 cells per size unit (default 5), each `spring`-retargeted by a seeded tick stream at 20–60 Hz, heat as `ink` weighted by per-cell `input` signals | Every cell settles on its last target within 1e-3; lanes on and off agree to the bit |
| `feed` | A chat or social feed | 100 items/s per size unit entering and leaving, the list re-sorted or filtered every 3 s, read by `pull` | Voices stay within one per item plus three; each departed item's `done` resolves exactly once, within 60 frames of being dropped; a dropped item probes as a stranger does |
| `timeline` | A video editor | 300 clips per size unit in nested spans under `history`; seeded scrubs, speed changes, jumps, and a reel owner turned back for reverse | At 20 checkpoints the live read equals a fresh timeline played forward to the same reel time; numbers that differ by frame rate alone are reported once and left out, and a mismatch is `undecided` only in a clip whose sequence the reel ran back over since the clip last started |
| `cues` | A theater lighting desk | 500 cues per size unit over 48 fixtures: follow cues by anchor, GO mid-fade, BACK, four manual faders as `level` signals | Levels match `cues/model.ts`, a plain-arithmetic cue sheet that knows nothing of blits |
| `kiosk` | Signage left running | One simulated hour per size unit (default 72) at 60 fps on a synthetic clock, 2,000 LEDs, three loops crossfading, a burst every 20 s, a 30-minute sleep and `rebase` each hour; loop lengths and burst timing follow the seed | Each hour the loop on show, and a clock loop cued at frame 0 on tiles of its own, match arithmetic from their starts; voices do not grow; once muted, `live` goes false |
| `rig` | Game character animation | 10 characters of 20 bones per size unit (a `quat` and a `vec(3)` each), clips as `keys` crossfaded in a role, an IK hold on one arm | At about 30 seeded frames during the run and 30 after, each bone's rotation is within 1e-6 rad of the role fold `role.mdx` documents, and its position matches the same fold of `vec(3, sum())`; whatever blits cannot say, the scenario does itself and reports as a `gap` |
| `deck` | A slide presentation | 40 slides per size unit of builds chained by anchors on `owns` owners under `history`; seeded next, back, jump, and next pressed mid-build | After each action, and at seeded frames mid-build, the deck equals a fresh one sought straight to the action's start and played to the same time; each build's `done` resolves at most once |

A check reports **fail** (blits is wrong by its own docs, or by the model), **undecided** (an
area blits has not settled, named in HANDOFF), or **gap** (something the scenario had to do
itself). A fail blits is known to have carries a `key` listed in `src/known.ts`; the run prints it
as `known`.

## Running

```sh
npm run stress -- <name> [--size n] [--frames n] [--seed n] [--window n] [--lanes off]
npm run stress -- digest apps/stress/runs/<run>
npm run stress:dev    # the page, on port 4885
```

A run prints its progress, then the run directory, `<stamp>-<name>-s<size>[-off]-<seed>`. That
directory holds `frames.jsonl` (a header naming the machine, its load, and the revision, then one
record per frame, or per `--window` frames) and `findings.json`. The command exits 1 when a `fail`
is not a known one, and 2 when it cannot read its flags.

Anything past a few seconds goes to the fleet (`onto do --kind bench ... -out apps/stress/runs`).
The `kiosk` default is about 15.5M frames, roughly 1.4 core-hours.

**Where runs go and what bounds them:** `apps/stress/runs/`, which is gitignored. The runner keeps
the newest five runs of each scenario and deletes older ones as it starts, except any touched in
the last 10 minutes, which may still be running. It also stops writing records past 50 MB in one
run, leaving a `{ "capped": frame }` record where it stopped. A result worth keeping is copied into `bench/runs/` by hand.

## Adding a demo

Write `src/scenarios/<name>/scenario.ts` against `src/scenario.ts`. It takes no DOM, takes every
random choice from `rng(seed)`, and reads only after a sync. Put the drawing in `draw`, in a
`view.ts` beside it once it runs long. Register it in `src/registry.ts`, and add
`test/<name>.test.ts`, which plays a small size and expects no `fail`.
