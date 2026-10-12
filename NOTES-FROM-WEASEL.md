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
  a new one comes, read by `pull` over a list kept dense by swap-remove; teitou, 2026-10-11,
  `f0283d6`, 8 own-process runs at `FRAMES=5000` beside other jobs). 0.36–0.74 ms a frame, median
  0.40, against 0.18–0.25, median 0.18, for the same voices steady (`tweens^`). Two things to know
  when reading the row. At `FRAMES=5000` its 10 s tweens land by frame 600 and the voices stay,
  held, so most of the run times landed tweens (run on a Mac: 1,000 such voices were all still
  cued at frame 1,300). And its `kB/frame`, about 136, is mostly the row's own copy of its list
  each frame: it read 136.6 before and 135.9 after a change that took 8.5 KB off a churned voice
  by `bench/churnwho.mjs`, the same shape with the list swapped in place. Read blits' share
  there. In a profile of 2026-10-04: `flush` writing row by row once the swaps have left slots
  out of list order, about 3,500 runs a frame at 10k, most of one to three subjects (counted on
  a Mac, 2026-10-11). `popDue` shows at up to 14%, but that is a Maglev deopt loop on its fresh
  `out` array, and removing the deopts saved no time. A user ease runs once per subject once
  start times differ, where voices started together share one call a frame: a cubic
  `1 - (1 - u) ** 3` costs about 0.1 ms at 10k against a line. Retargeting each tween as it is
  cued, as weasel's codec does, costs nothing further (`RETARGET=1 bench/scatter.mjs`).
- **Starting one tween voice over 10k nodes** (cue, one sync, a probe per node) costs about 2× a
  `fn` voice in plain Node: about 35 ms warm against 16, and 80–90 cold against 28–42 (weasel,
  orochi under load, 2026-10-02). A cold run in blits' own shape read the other way, 34 against 49.
  weasel's vitest row read 8×, which weasel puts down to collection landing in its few measured
  iterations, untraced. Not worth chasing until it shows outside a microbench.

- **Neither what a churned voice leaves alive nor the garbage it makes is weasel's gap.**
  Reusing a retired voice's records was prototyped (2026-10-05, teitou; the prototype was
  deleted): pooling everything blits allocates per voice halved what a churned voice leaves alive
  (2,819 to 1,424 B with a patch per voice), but weasel's loop after churn moved 0.487 to 0.466
  ms, inside teitou's ±0.08 noise, against 0.21 with no voice. On blits `6c4b3bf` that loop
  already reads 0.47–0.49, not 0.4.0's 0.66–0.75. The garbage went from 21.5 to 13 KB per churned
  voice (2026-10-11, teitou, `bench/churnwho.mjs` at 5,000 voices, three passes a side; 20.6 to
  12 with `SHARED=1` for one shared patch), and no time came with it: `turnover^` read 0.433 and
  0.399 ms and `churn^` 0.324 and 0.308 (medians of 8 own-process runs a side at `FRAMES=5000`
  against `657f3f2`, every row's runs overlapping the other side's, ten rows, geometric mean
  0.971, on a node running other jobs). What went, in KB per churned voice as each was measured
  alone: `Array.from` over a `subarray` in motion's `latest` and `applied`, about 500 B a call
  for three axes, with a `latest` that `prune` made to read one field (5.0); the three views a
  crowd row was copied through when compaction moved it (1.1); `retouch`'s Set, spread and sort
  (1.0); the view `pull` copied a run of 65 to 256 values through (1.4). `pull` also kept nothing
  of a channel between calls: 0.35 KB a call for one vec channel, and 1.1 to 1.7 kB a frame off
  the bench's four-channel rows (`tweens^` 6.6 to 4.9). What a churned voice still allocates, by
  a sampling heap profile on a Mac: the new voice, its handle and its patch (about 3 KB, which is
  what pooling covered), its entry and keys in the departed index (about 1.3), `drop`'s closures
  (0.8), the copies of a stretch a retarget keeps (about 1), and the 3 KB a frame that steady
  frames allocate too, in code that runs once a frame. Nothing was tried against those. Left
  untested: the host's own patch per voice (about 0.9 KB, which blits cannot recycle), which
  weasel's codec on one shared tween patch per ease and duration would decide.

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
  dropped: when the caller reads one field V8 removes `at`'s fresh object. Through weasel's
  own bench on blits 0.8.1 (teitou, 2026-10-10, mean ms a frame over three passes, beside the
  0.7.0 passes in weasel's `docs/proposals/2026-09-30-animator-on-blits.md`): 100 tracks
  0.0033 / 0.0033 / 0.0036 from 0.0042 / 0.0041 / 0.0040; 1,000 tracks 0.0434 / 0.0534 / 0.0476
  from 0.0527 / 0.0466 / 0.0550; 10,000 tracks 0.4090 / 1.0230 / 0.4198 from 0.4722 / 0.4863 /
  1.0391, against 0.16–0.19 for weasel's old sampler. One pass in three reads about 1.0 at
  10,000 on both versions, and both passes on studio read 1.17, so the row has a slow mode
  nobody has explained. Around each `patch.at`, weasel's `sampleTrack` makes two `Map` reads
  and a call through a stored function, a share this bench does not separate.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **A weight per axis of a `vec` channel, and an angle that lerps the short way.** weasel's
  animator held a value on a target as voices sharing a `locus`, weighted by `weight`, until
  2026-10-11. It now cues one voice per target and folds the holds itself
  (`packages/core/src/animation/engine/holds.ts`), for two things a locus could not do: a hold
  that covers some components of the value and not others, such as an IK arm beside clips
  holding the rest of a rig, and holds on an angle that meet at their average direction, not
  each the short way from rest. weasel uses neither `locus` nor a voice `weight` any more.
- **Observability that costs nothing unwatched.** Covered without weasel's `watch(listener)`:
  `mix.voices(tag?)` lists what is playing and `handle.weightOf` says at what weight, each free
  until asked.

## What weasel would need before depending on blits

For context. weasel has no stacking model: two animations writing the same property resolve as
last-writer-wins, which its vertex-color and animation specs both flag as unsolved. blits' channel
model is the answer to that. For weasel to use it, blits has to be on npm (`@weasel-js/core`
can't take a `file:` dependency), the out-object bug has to be fixed, and the hot path has to run
at scene sizes: thousands of nodes, probed from the paint walk every frame.
