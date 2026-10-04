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

- `atRest` runs a second fold, though on reused deltas, wherever a subject has a voice off lanes;
  one whose every voice is laned reads the lanes' values instead (since 2026-10-04).
- `probe` with no `out` stores a freshly allocated pose per subject per frame. weasel measured this
  pattern: a new pose object per node per frame took major GC from 57 ms to 549 ms over 10 s
  (`docs/superpowers/specs/2026-08-24-frame-loop-decoupling-design.md` in weasel).
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
  `2ad0063`). 0.43 ms a frame against 0.32–0.33 for the same voices steady (`tweens^`). In the
  profile: `moveTo` compacting all 10k voices to drop the one that retired (about 4%; skipping it
  would touch every reader of the voice list), and `flush` writing row by row once the swaps have
  left slots out of list order. `popDue` shows at up to 14%, but that is a Maglev deopt loop on its
  fresh `out` array, and removing the deopts saved no time. A user ease runs once per subject once
  start times differ, where voices started together share one call a frame: a cubic
  `1 - (1 - u) ** 3` costs about 0.1 ms at 10k against a line.
- **Starting one tween voice over 10k nodes** (cue, one sync, a probe per node) costs about 2× a
  `fn` voice in plain Node: about 35 ms warm against 16, and 80–90 cold against 28–42 (weasel,
  orochi under load, 2026-10-02). A cold run in blits' own shape read the other way, 34 against 49.
  weasel's vitest row read 8×, which weasel puts down to collection landing in its few measured
  iterations, untraced. Not worth chasing until it shows outside a microbench.
- **Memory with `target`:** a mix of 1,000 per-node voices reached by `target` held about 810 MB
  after 40 frames on 2026-10-02, growing with the square of the count. Since 2026-10-04 the
  subjects a voice does not reach share one record, and the same mix holds about 37 MB after
  its first frame (`bench/memory.mjs 1000 targets`): what still grows with the square is one map
  entry per voice and subject, `target`'s remembered answer. With `subjects` it stays at a few
  MB. `target`'s doc says so and points to `subjects`.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **Events on a timeline.** weasel's event tracks fire only on forward crossings of
  `(previous, playhead]`, and report `lateBy` in ms. With a `booking` they are scheduled 100 ms
  ahead against an outside clock (an audio engine's `now()`), and a pause, seek, rate change or
  edit retracts the booking. blits now has the small half: a patch `send`s timestamped events and
  the host `drain`s them (2026-09-30, for magicsmoke). Booking ahead, retraction and `lateBy` are
  still weasel's alone; wod's sound cues would want them.
- **Pause and time scale at every level, multiplied.** weasel scales the whole animator, a key and
  a handle, and multiplies the three. blits has `rate` per voice and nothing mix-wide.
- **Nesting.** A weasel timeline can hold child timelines at offsets, and the parent owns their
  playback. A blits voice is flat.
- **Observability that costs nothing unwatched.** weasel's `watch(listener)` and `live()` build
  event objects only while something is subscribed. blits now answers "at what weight" per voice
  and subject (`handle.weightOf`, free unasked, 2026-09-30). "What is playing" still has no answer
  without holding every handle: a mix cannot list its voices.

## What weasel would need before depending on blits

For context. weasel has no stacking model: two animations writing the same property resolve as
last-writer-wins, which its vertex-color and animation specs both flag as unsolved. blits' channel
model is the answer to that. For weasel to use it, blits has to be on npm (`@weasel-js/core`
can't take a `file:` dependency), the out-object bug has to be fixed, and the hot path has to run
at scene sizes: thousands of nodes, probed from the paint walk every frame.
