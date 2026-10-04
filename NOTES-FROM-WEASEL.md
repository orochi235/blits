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

- `atRest` runs a second fold, though on reused deltas.
- `probe` with no `out` stores a freshly allocated pose per subject per frame. weasel measured this
  pattern: a new pose object per node per frame took major GC from 57 ms to 549 ms over 10 s
  (`docs/superpowers/specs/2026-08-24-frame-loop-decoupling-design.md` in weasel).
- **weasel's `animator-on-blits` on teitou against `2da21c1`** (weasel, Node 26.10, six passes,
  2026-10-03, vitest means in ms per frame at 10k): a tween motion voice per animation read by
  `pull` costs 0.42–0.46, the same as one shared tween voice (0.39–0.47), so weasel expects to drop
  its own grouping. Without building `{x, y}` sinks 0.35–0.38. By `probe` 0.82–0.94; a `keys` voice
  per animation by `probe` 1.74–1.95, which no crowd serves yet (`HANDOFF.md` 1c). A spring voice
  per animation by `pull` 0.60–0.65. weasel's old animator reads 0.22–0.37 for its whole frame;
  its animator rebuilt on blits 0.77–0.88, about blits' `pull` plus weasel's own per-call work.
- **Starting one tween voice over 10k nodes** (cue, one sync, a probe per node) costs about 2× a
  `fn` voice in plain Node: about 35 ms warm against 16, and 80–90 cold against 28–42 (weasel,
  orochi under load, 2026-10-02). A cold run in blits' own shape read the other way, 34 against 49.
  weasel's vitest row read 8×, which weasel puts down to collection landing in its few measured
  iterations, untraced. Not worth chasing until it shows outside a microbench.
- **Memory with `target`:** a mix of 1,000 per-node voices reached by `target` held about 810 MB
  after 40 frames (720 MB before lanes), growing with the square of the count, from the record each
  voice keeps per subject it is asked about. With `subjects` it stays at a few MB. `target`'s doc
  now says so and points to `subjects`.

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
