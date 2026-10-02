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
- **weasel's `animator-on-blits` against lanes** (blits `461efe4`, studio, 2026-10-02, vitest means
  in ms, two runs; weasel's own animator in brackets): at 10k, one voice reads 2.4–2.6 for a `fn`
  tween [0.44–0.47] and 2.4–3.3 for a spring [0.63–0.73]; a voice per call (`subjects`) 3.8–4.2
  for a `keys` tween and 4.5–4.9 for a spring. Lanes clearly win only on the spring per call
  (lanes off 6.1–7.1). The one-voice `fn` tween ran slower with lanes on than off (2.4–2.6 vs
  2.1–2.2), since its `at` looks each node's endpoints up by string id. **blits now has `tween`**,
  which keeps those endpoints as data: on blits' own bench in that shape it takes a frame to
  0.83 of the `fn`'s and its collection pauses to a quarter; weasel's bench has not been rerun on
  it. Starting 10k voices, one per call, costs 138 ms for tweens and 89 for springs on the first
  frame [10–15]. What still stands between blits and weasel: the probe floor (about 110–140 ns at
  10k even when a lane did the work) and a voice per call being a lane per voice; `HANDOFF.md`
  item 1c has the next step for each.
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
