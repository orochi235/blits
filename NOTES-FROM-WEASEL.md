# Notes from weasel

**For:** whoever is working on blits next. **Answers:** what a read of blits from the weasel side
turned up: bugs, where the per-frame time goes, and what weasel has that blits doesn't.
Written 2026-09-29 against `6cd7a49`; its three bugs were fixed in `5f4b2e5`. weasel (`~/src/weasel`, published as `@weasel-js/core`) is a 2D
scene-graph canvas engine whose animator lives in `packages/core/src/animation/`.

Everything under "Speed" was measured, not just read: `src/` compiled with `tsc` and driven
from plain Node 24. Anything that is a suggestion says so. When an item is dealt with, delete it,
and delete this file once it is empty.

## Speed

What is left, measured by `npm run bench` (`bench/frame.mjs`) and a CPU profile:

- **weasel's `animator-on-blits` on teitou against `5a514a3`** (weasel, Node 26.10, three passes
  alternated, 2026-10-04, vitest means in ms per frame at 10k). blits alone: a tween voice per
  animation read by `pull` 0.38–0.42, one shared voice 0.34–0.41, a spring voice per animation
  0.56–0.61. Through weasel's whole animator, old against on blits: tweens steady 0.25–0.36
  against 1.02–1.08; one tween stopped and one started each frame 0.18–0.19 against 1.33–1.38
  (28–50 ms on `2da21c1`); springs 0.73–1.08 against 0.62–0.67, where blits now wins. weasel
  puts the tween gap down to its own per-animation reads (about 0.5 ms, being removed) and a
  drop it still defers a frame.
- **Churn, what is left** (`turnover^`, weasel's shape: each frame one subject leaves for good and
  a new one comes, read by `pull` over a list kept dense by swap-remove; teitou, 2026-10-04,
  `ae6565f`). 0.41–0.42 ms a frame against 0.32–0.33 for the same voices steady (`tweens^`). In
  the profile: `flush` writing row by row once the swaps have left slots out of list order. `popDue` shows at up to 14%, but that is a Maglev deopt loop on its
  fresh `out` array, and removing the deopts saved no time. A user ease runs once per subject once
  start times differ, where voices started together share one call a frame: a cubic
  `1 - (1 - u) ** 3` costs about 0.1 ms at 10k against a line. Retargeting each tween as it is
  cued, as weasel's codec does, costs nothing further (`RETARGET=1 bench/scatter.mjs`).
- **Starting one tween voice over 10k nodes** (cue, one sync, a probe per node) costs about 2× a
  `fn` voice in plain Node: about 35 ms warm against 16, and 80–90 cold against 28–42 (weasel,
  orochi under load, 2026-10-02). A cold run in blits' own shape read the other way, 34 against 49.
  weasel's vitest row read 8×, which weasel puts down to collection landing in its few measured
  iterations, untraced. Not worth chasing until it shows outside a microbench.

- **Reusing a retired voice's records was prototyped and measured no help to weasel**
  (2026-10-05, teitou; the prototype was deleted). Pooling everything
  blits allocates per voice halved what a churned voice leaves alive (2,819 to 1,424 B with a patch
  per voice), but weasel's loop after churn moved 0.487 to 0.466 ms, inside teitou's ±0.08 noise,
  against 0.21 with no voice. On blits `6c4b3bf` that loop already reads 0.47–0.49, not 0.4.0's
  0.66–0.75. The gap left does not scale with blits' survivors; untested candidates are the host's
  own patch per voice (about 0.9 KB, which blits cannot recycle) and the 14–25 KB of garbage blits
  makes per churned voice (lane compaction `subarray`, `retouch`'s Set and sort, `Array.from` in
  motion's `latest` and `applied`). The next run that would decide it: weasel's codec on one shared
  tween patch per ease and duration. `bench/churnwho.mjs` (`SHARED=1` for one shared patch)
  diffs the heap per churned voice.

- **A `keys` read costs several times weasel's own keyframe sampler.** weasel's `sampleTrack`
  reads one `keys` patch per track (`patch.at(phase)`, one numeric channel, four stops) since
  2026-10-08. Measured on teitou, Node 26.10, blits 0.7.0, plain node, 10k tracks each read once a
  frame, ms per frame over three rounds: weasel's old binary search and lerp 0.058–0.076;
  `patch.at` 0.33–0.40; `readKeys` into one reused out object 0.31–0.32; `segment` plus a plain
  lerp, skipping `read` 0.22. So the fresh `{}` per read is about a sixth of it, `read`'s generic
  path (slope check, `lastRead`, `interpolate`'s type tests) about a third, and the search itself
  is still three times a plain binary search. Suggestion, untested: a public read that takes an
  out object, and a single-channel numeric fast path. weasel's script was
  `tests/perf/scratch/sample-cost.mjs` (not committed); the committed bench is weasel's
  `tests/perf/bench/timeline-sampling.bench.ts`.
  Since `bce8fa3` (2026-10-08), a track whose stops are all plain numbers, lerped straight across,
  is read by its own binary search and lerp over flat arrays, bit for bit what the general read
  gives. In `bench/keys.mjs` (weasel's shape, this Mac under a load average of about 11, six
  alternated rounds) `patch.at` reads 0.796 ms a frame against 1.134 before. A public read into
  a reused out object was built and measured slower than `at` (0.87 against 0.78 ms), so it was
  dropped: when the caller reads one field V8 removes `at`'s fresh object. Not yet measured: the
  same through weasel's own bench.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **Observability that costs nothing unwatched.** Covered without weasel's `watch(listener)`:
  `mix.voices(tag?)` lists what is playing and `handle.weightOf` says at what weight, each free
  until asked.

## What weasel would need before depending on blits

For context. weasel has no stacking model: two animations writing the same property resolve as
last-writer-wins, which its vertex-color and animation specs both flag as unsolved. blits' channel
model is the answer to that. For weasel to use it, blits has to be on npm (`@weasel-js/core`
can't take a `file:` dependency), the out-object bug has to be fixed, and the hot path has to run
at scene sizes: thousands of nodes, probed from the paint walk every frame.
