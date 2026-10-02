# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. Each release lists its changes as **Breaking**, **Added** and
**Fixed**, and the release workflow refuses a tag with no section here.

## Unreleased

### Added

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

- A probe looks its subject up once rather than once per voice, which makes frames with several
  voices 5–12% faster.

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
