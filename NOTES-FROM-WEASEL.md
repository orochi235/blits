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
- **weasel's `animator-on-blits` against one shared voice** (blits `26c9764`, studio, Node 26.8.1,
  2026-10-02, vitest means in ms per frame at 10k nodes, two runs; weasel's own animator in
  brackets [0.42–0.44 tween, 0.67–0.94 spring]). One `tween` voice over every node, read by
  `probe` per node: 2.0–2.1 (2.6–2.7 lanes off), level with a `fn` voice at 2.1. A voice per call:
  3.8–3.9. One spring voice: 2.5; a spring voice per call 4.6–4.7. Like for like on teitou at
  `de5ba57` (weasel, Node 26.10, three runs, 2026-10-02), one tween voice over 10k read by `pull`:
  0.33–0.40 ms bare (`sync` + `pull`, nothing allocated per node) against weasel's 0.15–0.16 bare,
  about 2.4×, though weasel's bare frame still builds a `{x, y}` per node; with each side writing
  its per-node sink, 0.38–0.46 against 0.20–0.33, about 1.5×. Read by `probe` 0.79–0.94; a voice
  per call 1.9. One spring voice by `pull` 0.57–0.66; weasel's own spring row is unstable on
  teitou (0.31–1.28), cause unknown. About 35–40 ns a node against weasel's 15.
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
