# Notes from weasel

**For:** whoever is working on blits next. **Answers:** what is left of a read of blits from the
weasel side: where the per-frame time goes, and what weasel has that blits doesn't. weasel
(`~/src/weasel`, published as `@weasel-js/core`) is a 2D scene-graph canvas engine whose animator
runs on blits. When an item is dealt with, delete it, and delete this file once it is empty.

## Speed

What is left, measured by `npm run bench` (`bench/frame.mjs`) and a CPU profile:

- **Churn, what is left** (`turnover^`, weasel's shape: each frame one subject leaves for good and
  a new one comes, read by `pull` over a list kept dense by swap-remove; `FRAMES=5000`, each row in
  its own process). Since `7e64030` (2026-10-29), `pull` gives the subject swapped into a dropped
  one's place the number the drop freed, so the list's numbers stay in its order: 0.263 → 0.223 ms
  a frame, U = 0, seven runs a side, teitou with the node to itself
  (`bench/runs/2026-10-29-pull-renumber.txt`). `tweens^` reads 0.165 and `churn^`, the same voices
  replaced without reordering, 0.210. A profile of both on keiei
  (`bench/runs/2026-10-29-turnover-prof-renumber.txt`) has `pullRun`, `copies`, `rests` and
  `bareRows` within 4% of each other, so list order no longer costs anything here. What is left
  over `tweens^` is the per-frame stop, drop and cue that `churn^` pays too (the next item), plus
  the row's own copy of its list, most of its 136 `kB/frame`. Not built: renumbering for lists
  reordered other ways (sorted, reversed, filtered), which needs two live subjects to swap numbers,
  and renumbering under history, roles or a bound, which `src/renumber.ts` declines.
- **Stopping a subject's voice and reading its replacement, what is left** (`bench/restart.mjs`,
  the shape weasel's codec drives: a tween voice per subject read by `pull`, 100 of them stopped,
  dropped, and cued again a frame; keiei alone, nine rounds, 2026-10-29,
  `bench/runs/2026-10-29-stop-seat.txt`): at 10,000 subjects the frame after the stops takes
  0.955 ms, the one after that 0.386, and a steady frame 0.239. Of the frame after, timed apart on
  orochi under load (2026-10-13): about 0.3 ms cueing the voices, 0.2 in `sync`, and 0.9 in the
  pull, against 0.46 for a frame with nothing changing once churn has left slots out of list order
  (the item above). The profile there is flat: `departed.add`, `retouch`, `copyRow` as a crowd
  closes up, a patch's first `grow`, each under 4%.
- **A stop still grows with N, and nothing in it walks more with N** (keiei alone, 2026-10-29,
  nine rounds, `bench/runs/2026-10-29-stop-seat.txt`; a stop is the handle's `fade({ over: 0 })`
  and the `drop` after it): 0.61 µs at 1,000 subjects, 1.60 at 10,000, and 2.92 at 40,000. Lookups
  in the mix's maps are a small part of it: holding a crowd voice's crowd and row in one `Seat` on
  the voice (`eed156c`) cut a stop's lookups by voice id from four to one and saved
  0.06 µs at 40,000 (2.98 before, inside noise). One entry per subject in place of `chains` and
  `named` would save one lookup, so about as much; decided against for now (2026-10-29). Skipping the due-queue push of a voice
  that retires at once measured no different (`bench/runs/2026-10-29-stop-due-push.txt`).
  `bench/stopparts.mjs` times each part of a stop at two sizes, and every part grows. Inferred,
  not counted: what a stop pays for is the first touch of each line it reads or writes, which is
  one or more per object of the voice (the voice, its store, its motion patch's `Numbers`) and one
  per parallel array of its crowd row and its subject number. Making a stop cheaper means fewer
  objects per voice and fewer arrays per row, not fewer stores per subject.
- **Neither what a churned voice leaves alive nor the garbage it makes is weasel's gap**, so
  neither is worth re-proposing for speed. Pooling everything blits allocates per voice
  (prototyped 2026-10-05, deleted) halved what a churned voice leaves alive and moved weasel's
  loop inside noise; cutting the garbage from 21.5 to 11.7 KB a churned voice (2026-10-11 to
  2026-10-24, `bench/churnwho.mjs`) moved no row. What is left is under 0.8 KB a site, by
  `bench/runs/2026-10-24-weasel-churnwho-alloc.txt`: `cue` itself, the voice, its handle and
  named record, the host's own patch and its `Motions` (which blits cannot recycle), `retire`,
  `prune` in `move.ts`, the fold's `moved`, and the stretch copies a retarget keeps (`latest` in
  `src/motions.ts` and `applied` in `src/changes.ts`), which are history, not garbage.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **A weight per axis of a `vec` channel, and an angle that lerps the short way.** The stress demos' `rig` (2026-10-30) hit the first of these too: its IK hold on a bone's height does that part itself after `pull`. weasel's
  animator held a value on a target as voices sharing a `locus`, weighted by `weight`, until
  2026-10-11. It now cues one voice per target and folds the holds itself
  (`packages/core/src/animation/engine/holds.ts`), for two things a locus could not do: a hold
  that covers some components of the value and not others, such as an IK arm beside clips
  holding the rest of a rig, and holds on an angle that meet at their average direction, not
  each the short way from rest. weasel uses neither `locus` nor a voice `weight` any more.
