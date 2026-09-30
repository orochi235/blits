# Notes from weasel

**For:** whoever is working on blits next. **Answers:** what a read of blits from the weasel side
turned up: bugs, where the per-frame time goes, and lessons weasel paid for that apply here.
Written 2026-09-29 against `6cd7a49`; its three bugs were fixed in `5f4b2e5`. weasel (`~/src/weasel`, published as `@weasel-js/core`) is a 2D
scene-graph canvas engine whose animator lives in `packages/core/src/animation/`.

Everything under "Speed" was measured, not just read: `src/` compiled with `tsc` and driven
from plain Node 24. Anything that is a suggestion says so. When an item is dealt with, delete it,
and delete this file once it is empty.

## Speed

Rewritten on 2026-09-29: `keys` stops are built once per channel with a binary search per read,
easings are resolved at build, one record per voice and subject replaces three lookups, the
`Setting` is reused per voice, channels are resolved to slots once per kit, and a fold with no locus
in play allocates nothing of its own. `npm run bench` (`bench/frame.mjs`) took fn 10k × 3 from
18.7 to about 10.5 ms per frame and keys 10k × 3 from 33.0 to 9.2. What is left, all measured by
that benchmark and a CPU profile:

- `vec` channels now fold in place (`Channel.fold`); `keys` still interpolates a new array per read
  of a keyed array, which is most of the 82 collections left in keys 10k × 3. Doing it in place
  must never write into a stop's own array: a prototype that did corrupted the keyframes.
- One WeakMap lookup per voice per subject (`Store.get`, 7.5% of a profile of fn 10k × 3). The
  patch's own function is 24% of the same profile.
- `atRest` runs a second fold, though on reused deltas.
- `probe` with no `out` stores a freshly allocated pose per subject per frame. weasel measured this
  pattern: a new pose object per node per frame took major GC from 57 ms to 549 ms over 10 s
  (`docs/superpowers/specs/2026-08-24-frame-loop-decoupling-design.md` in weasel).
- `mixHex` unpacks both colors on every call; a `keys` segment's endpoints are fixed, so that could
  happen once per segment.

## Lessons weasel paid for

**Retargeting position without velocity leaves a kink.** `from: 'current'` starts a keys voice
where the subject is now, but its first segment starts from zero speed wherever the old motion was
heading. weasel's `physics` has `setTarget` and `setVelocity` for this. The one place weasel
doesn't carry velocity (reflow glides) is written up as a known gap.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **Events on a timeline.** weasel's event tracks fire only on forward crossings of
  `(previous, playhead]`, and report `lateBy` in ms. With a `booking` they are scheduled 100 ms
  ahead against an outside clock (an audio engine's `now()`), and a pause, seek, rate change or
  edit retracts the booking. Sound cues in wod or magicsmoke will want this. A blits voice can
  only produce values.
- **Pause and time scale at every level, multiplied.** weasel scales the whole animator, a key and
  a handle, and multiplies the three. blits has `rate` per voice and nothing mix-wide.
- **Nesting.** A weasel timeline can hold child timelines at offsets, and the parent owns their
  playback. A blits voice is flat.
- **Observability that costs nothing unwatched.** weasel's `watch(listener)` and `live()` build
  event objects only while something is subscribed. A mix can't currently answer "what is
  playing and at what weight" without a debugger.

## What weasel would need before depending on blits

For context. weasel has no stacking model: two animations writing the same property resolve as
last-writer-wins, which its vertex-color and animation specs both flag as unsolved. blits' channel
model is the answer to that. For weasel to use it, blits has to be on npm (`@weasel-js/core`
can't take a `file:` dependency), the out-object bug has to be fixed, and the hot path has to run
at scene sizes: thousands of nodes, probed from the paint walk every frame.
