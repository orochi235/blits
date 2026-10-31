# Stress demos — design

**Status: unbuilt (2026-10-30).** For whoever builds or reads `apps/stress`. It answers what the
stress demos are, what each one loads blits with, and what counts as blits getting it right.
Approved 2026-10-30; delete this file once the app's README holds what is still true.

Seven demos, each a realistic app shape, chosen to find where blits is slow (speed and capacity)
or wrong (correctness), and to note where its vocabulary cannot say what the app needs.

## Shape

A private workspace app, `apps/stress`, one folder per demo:

| File | Role |
|---|---|
| `src/scenarios/<name>/scenario.ts` | Builds the mix and subjects from a seed and a size; `step(frame)` feeds that frame's workload; `read()` probes every subject into one flat `Float64Array`; `check()` runs the demo's correctness check. No DOM; every random choice comes from the seed. |
| `draw` on `src/scenarios/<name>/scenario.ts` | Draws the scenario on a canvas; a `view.ts` beside it holds the drawing only when it runs long. |
| `src/run.ts` | Node runner: `npm run stress -- <name> --size N --frames F --seed S`. Bundled by esbuild against the engine's `src/`. Prints progress as it goes (`frame 1200/6000`), writes one raw record per frame (per window for the soak), with a header naming the machine, load, revision and arguments. Digests are computed from the records afterward (`src/digest.ts`). |
| `index.html`, `src/main.ts` | One page: a scenario picker, the canvas (capped at 400 px tall), a fixed-width frame-time readout. Serves on `::`. |

**Bounded output.** Runs land in `apps/stress/runs/<date>-<name>-<seed>/`, gitignored. The runner
keeps the newest 5 runs per scenario, deleting older ones as it starts, and stops writing past
50 MB in one run. A result worth keeping is copied into `bench/runs/` by hand.

**Tests.** Each scenario has a small-size vitest running its `check()`, in the normal suite.
Large sizes and the soak go to the fleet with `--kind bench`.

## The demos

| Demo | Workload | Correct means |
|---|---|---|
| Market heatmap | 5,000 cells (to 50,000), each `spring`-retargeted when a seeded tick stream hits it, 20–60 Hz | Each cell settles on its latest target; lanes and `BLITS_LANES=off` agree to the bit |
| Live feed | 100 items/s entering and leaving a list re-sorted and filtered every few seconds, read by `pull` | Voice count stays bounded; each item's `done` resolves exactly once; an item that left shows nothing |
| Video timeline | 300 clips in nested spans under `history`; seeded scrubs, rates −2 to 4, jumps | Pose after `seek(t)` equals a fresh mix played forward to `t`; hits on a child under a backward owner are reported **undecided**, not failed |
| Cue stack | 500 cues: follow cues, `anchor`, overlapping fades, GO/BACK, manual faders as `input` signals | Levels match a small hand-written cue-sheet model, independent of blits |
| Kiosk soak | 72 simulated hours at 60 fps on a synthetic clock: loops, crossfades, occasional `rebase` | Per simulated minute: heap, voice count, frame-time percentiles. A loop's phase at hour 72 matches a fresh mix started there; `live` goes false once all is at rest |
| Character rig | 50 characters × 20 bones (a quat and a `vec(3)` each); clips as `keys`, crossfaded, with an IK hold on one arm | Poses match a hand-computed slerp blend. Whatever blits cannot say, the scenario does itself and lists under **gaps** |
| Slide deck | 40 slides of builds in spans and anchors; seeded next, back, jump, interrupt-halfway | After each action the deck equals a fresh one sought straight there; `done` resolves exactly once per build |

## Running and reporting

Small checks run locally. Large sizes and one soak run once on the fleet at the end; the soak's
cost is estimated from a 10-simulated-minute timing before it launches. Failures and gaps are
recorded in HANDOFF (the rig's in `NOTES-FROM-WEASEL.md` where they match weasel's).
