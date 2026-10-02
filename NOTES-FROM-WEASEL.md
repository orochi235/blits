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

- `keys` interpolates a new array per read of a keyed array: about 88 of the collections in
  keys 10k × 3. Branch `keys-scratch` (`914f69e`) reuses one per voice per subject and halves
  them, but measured 6% slower per frame on an idle fleet node, so it is unmerged pending a call.
- `atRest` runs a second fold, though on reused deltas.
- `probe` with no `out` stores a freshly allocated pose per subject per frame. weasel measured this
  pattern: a new pose object per node per frame took major GC from 57 ms to 549 ms over 10 s
  (`docs/superpowers/specs/2026-08-24-frame-loop-decoupling-design.md` in weasel).
- A frame of 10k subjects on one voice reads 2.0 ms for a `fn` tween and 4.4 ms for a `spring`,
  against 0.3 and 1.0 ms for weasel's own animator doing the same arithmetic (weasel's
  `tests/perf/bench/animator-on-blits.bench.ts`). A fast path for a subject one voice reaches was
  tried on 2026-10-01 and dropped: skipping the fold changes results in the last bit (`mul` at
  weight 1, `-0` under `sum`, `max` against rest), and the variants that stay exact measured no
  faster. `spikes/gpu-engine` on branch `spike/gpu-engine` measures what a dense engine would do.

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
