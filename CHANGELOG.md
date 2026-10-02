# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. Each release lists its changes as **Breaking**, **Added** and
**Fixed**, and the release workflow refuses a tag with no section here.

## Unreleased

### Breaking

- `spring` and `glide` build patches of a third form, `'motion'`, instead of `'fn'`, and carry
  their kind and constants on `patch.motion`, a `MotionSpec`. `Patch.form` and `Engine.runs` take
  `'motion'`, so an engine that declares `runs` must list it to run a spring or a glide. A motion
  patch throws when two of its subjects, or a subject's start, target and velocity, or a `to` or
  `push`, move on different numbers of axes. It makes a subject's first stretch at its first `to`
  or `push` as well as at its first read, so `read(subject, at)` answers from then on.
- An untimed retarget lands at the subject's own voice time at the mix's latest sync, not at the
  subject's next read, so a subject the host did not probe changes at the same moment as one it
  did; `read` with no time answers at that time, counting every change due by then. For a subject
  no frame of its voice has met yet, or still inside its stagger, an untimed change applies at its
  first read, after any timed change due by then, and `read` with no time returns undefined, as it
  does once the voice is gone. Changes apply in time order, not the order they were made.
- `drop(subject)` also forgets a motion patch's state for the subject, so it starts afresh.
- With lanes on, a stateless patch calling `setting.send` from `at` sends every frame for every
  subject the mix has met, probed that frame or not; and a patch that first calls `setting.keep`
  partway through playing can advance that state once more for one subject the host did not probe
  that frame.
- `mixHex`, and so the `hex` channel, blends in OKLCH rather than sRGB, taking hue the short way
  round and a gray end's hue from the other end. A crossfade from red to blue passes through
  0xba00c2 rather than 0x800080, and black to white through 0x636363 rather than 0x808080. A blend
  costs about 45 ns where the two ends repeat frame to frame and 210 ns where every call brings new
  colors, against 8 ns in sRGB. `hex({ space: 'srgb' })` keeps the sRGB blend.
- `Mix` has a `pull` method, so an engine's `create` must return a mix that implements it.

### Added

- `tween(writes, { from, to, ms, ease? })`, a motion patch that eases each subject from one value
  to another over `ms`, with `from` and `to` given per subject and read once when the mix first
  meets it. `to(subject, target)` retargets one subject from where it is over a full `ms` again,
  and `read` reports value and velocity as a spring's does. It runs on lanes as springs do, with
  each subject's endpoints as data, so a tween over every subject no longer needs a `fn` that looks
  its endpoints up on each call: in weasel's shape (10,000 string ids, endpoints in a map) a frame
  costs 0.83 of that `fn`'s and pauses for collection a quarter as long. A motion lane no longer
  allocates a delta per subject either, which takes a spring frame over 10,000 subjects to
  0.82–0.90 of the last build's. `MotionSpec` gains
  `{ kind: 'tween', ms, ease }`.
- Lanes: a channel every voice writing it can run that way is computed for every subject at once,
  in flat arrays, at the frame's first probe, rather than subject by subject, and gives the same
  pose. `keys`, a stateless `fn` and `motion` voices with a number weight qualify. Three `keys`
  voices over 10,000 subjects fell from 6.1 to 2.6 ms a frame. A lane whose subjects were mostly
  left unprobed last frame stops filling and its subjects take the general path until probes pick
  up again, so a host probing 5% of 10,000 subjects pays about what it would with lanes off, not
  ten times it. `MixOptions.lanes: false` turns lanes off. They cost a little on frames they
  don't serve: a voice per subject reads up to 7% slower at 10,000 subjects (about 20% at
  100–1,000, a few hundredths of a millisecond), a mix probing few of its subjects about 0.03 ms
  more, and a projection made every frame about 10% more.
- `mix.pull(subjects, { channel: Float64Array, ... })` writes each subject's pose into one array per
  channel, in the order given, giving what `probe(subject, out)` gives without a pose object per
  subject. A channel of `n` numbers takes `n` places a subject; one with no value writes NaN. While
  every voice runs on a lane it copies straight from the lanes: a frame of three `keys` voices
  over 10,000 subjects costs 0.84 of the same frame read through `probe`, a spring 0.91.
- `mix.project(timestamp)` reads the mix at another time without moving it: `probe` gives the pose
  then, and `assess` says per channel whether it is `exact`, `stepped` or `held`. Ahead it plays
  what is cued forward; behind it needs `MixOptions.history: { ms, every? }`, which keeps every
  handle change, the voices that left, and copies of stateful state, so a read back under `stepMs`
  lands on the pose the mix showed, and with `inputs` it records what input weight signals and the
  host fields patches `reads` held, so a read back over a `level` or a pointer is known. `Patch.clone` copies state `structuredClone` cannot.
- The score: a voice takes a `name` and an `anchor` placement, `start` or `in` and `out` or `end`,
  each a timestamp or another voice's mark (`after`, `with`, `before`, or `of` plus `mark`),
  selected by name, tag or written channel with a resolver. Each source can keep its own `score`,
  with names namespaced per score. `mix.announce(name, { at? })` puts a named mark on a score for
  anchors to wait on, and `mix.marks(from, to)` lists every mark the plan knows.
- `spring` and `glide` keep every stretch within the mix's history, so a read before a retarget
  finds where the subject was.
- A cue can name its subjects, `subjects: [a, b]`, in place of a `target`. The mix files the voice
  under each one, so a voice per subject costs the same as one voice: the first frame of 1,000
  subjects on a voice each fell from about 500 ms to 1 ms.

### Fixed

- A voice faded before its start plays once its start arrives. It used to stay out of every
  subject's fold until some other voice was cued or left.
- A probe after a `seek` in the same frame reads the voice where the seek put it, rather than the
  value an earlier probe that frame read before the seek. A stateful patch still steps once.
- A probe looks its subject up once rather than once per voice, which makes frames with several
  voices 5–12% faster.
- A `keys` patch reads a keyed `vec` channel into an array its voice reuses, rather than a new one
  each read, which halves collections at 10,000 subjects and leaves frame time unchanged.

- A finite loop's fade out starts when its last pass ended, not at the first frame after, so it
  plays the same at any frame rate.
- The published `package.json` no longer lists `workspaces: ["site"]`, which only the repo's docs
  site uses.

## 0.2.1

### Added

- Channel `bounds`: `sum`, `mul` and `max` take `{ bounds: [min, max] }`, and `vec` inherits its
  axis channel's. The mix clamps the folded value to the range, so stacked voices and a retarget
  that carries speed stop flat at the bound. Bounds are part of the channel's kind.

## 0.2.0

### Breaking

- A `keys` voice cued with `from: 'current'` now leaves at the velocity the subject had, taken from
  its last two probed poses, instead of on the first segment's own curve. A subject that was still
  leaves at rest. Only the first segment changes, and it still lands on its stop.
- `Handle` gains `ramp`, so an object written to stand in for a handle needs one.

### Added

- `handle.ramp(rate, over)`: eases a voice's playback rate to a new one over `over` ms, so a pause
  or a slow-motion does not snap. The voice clock integrates the ramp.

- `spring` and `glide`: momentum in closed form, per subject, so where a subject is does not depend
  on frame rate. `spring.to` retargets and `push` sets a velocity mid-flight, each starting the next
  stretch from where the subject is and how fast it moves; `read` returns both, for handing motion
  to another patch.

### Fixed

- Keyed stops, and a `from: 'current'` retarget, interpolate through the channel's own `lerp`, as
  the schema says. They used plain numeric interpolation unless `lerpBy` named one, so a keyed
  `hex` color blended its packed integer instead of its components. `lerpBy` still wins, and a
  `keys` patch read outside a mix uses the `kit` it names.

## 0.1.1

### Fixed

- Published from the release workflow through npm's trusted publishing, with a provenance
  statement. The code is 0.1.0's; only the version and this changelog differ.

## 0.1.0

First release, published by hand. A mix folds concurrent effects into one value per subject per frame: each effect runs
on its own clock with its own state and weight, and the rules for combining them belong to the
channel being written rather than to the effect writing it.

What is here: the stock channels (`sum`, `mul`, `max`, `last`, `vec`, `hex`), both authoring forms
for a patch (a function of phase, or a list of keyframes), voices with rates, loops, stagger, fade
envelopes and loci, the five signals (`peak`, `slew`, `lag`, `level`, `gate`) with their state
kept per voice and subject, per-subject state that catches up by its own gap or, under `stepMs`, at a
fixed interval so it plays the same at any frame rate, events a patch sends for the host to `drain`,
`handle.weightOf` for reading a voice's weight per subject, the checks that let one package's
patches mix into another's (`Channel.kind`, `Patch.kit` and `Patch.reads` checked at `cue`, and
`tags` to drain one package's events), and the `Engine` seam behind `mix`.

[klieg](https://github.com/orochi235/klieg) composes its motion, its effects and its lighting on
this, which is where the arithmetic was proven: that port changed no number and moved no baseline.

Zero runtime dependencies. ESM only. The design is `docs/schema.html`, shipped alongside.
