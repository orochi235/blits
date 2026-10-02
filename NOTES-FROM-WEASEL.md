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
- A frame of 10k subjects on one voice read 2.0 ms for a `fn` tween and 4.4 ms for a `spring`,
  against 0.3 and 1.0 ms for weasel's own animator doing the same arithmetic (weasel's
  `tests/perf/bench/animator-on-blits.bench.ts`, 2026-10-01 against `project`; a voice per call
  read 3.6–3.9 and 6.6–6.9 ms). **Lanes (branch `lanes`, 2026-10-02) closed part of this, not
  most of it.** On blits' own bench on the fleet, `keys` frames fell to 0.35–0.53× and a stateless
  `fn` to 0.63–0.95×; springs rose to 1.13–1.61×, because the same branch slowed a spring on the
  general path more than lanes win back; a voice per subject named with `subjects` did not move. What still
  stands between blits and weasel's numbers: a probe costs about 110–140 ns at 10k even when a lane
  did all the work, which a paint walk probing every node pays in full; a `fn` tween allocates its
  delta per call; and a voice per call is a lane per voice. `HANDOFF.md` item 1c has the next steps
  for each, and the table is in `spikes/gpu-engine/README.md`. weasel's own rerun of
  `animator-on-blits` and `pose-overrides` against the build is pending.

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
